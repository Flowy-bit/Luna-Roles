require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require('discord.js');
const mongoose = require('mongoose');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
// Mets l'ID du rôle qui peut utiliser /giverole et /retirerole
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;
// Mets l'ID du salon où les logs seront envoyés
const LOG_CHANNEL_ID  = process.env.LOG_CHANNEL_ID;
// ───────────────────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ MongoDB erreur:', err));

const TempRole = mongoose.model('TempRole', new mongoose.Schema({
  guildId:   String,
  userId:    String,
  roleId:    String,
  expiresAt: Date,
}));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ─── COMMANDES SLASH ───────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('Donne un rôle temporaire à un utilisateur')
    .addUserOption(o =>
      o.setName('utilisateur').setDescription('L\'utilisateur cible').setRequired(true))
    .addRoleOption(o =>
      o.setName('role').setDescription('Le rôle à attribuer').setRequired(true))
    .addStringOption(o =>
      o.setName('duree').setDescription('Durée du rôle').setRequired(true)
        .addChoices(
          { name: '1 jour',    value: '1d' },
          { name: '1 semaine', value: '1w' },
          { name: '1 mois',    value: '1m' },
        )),

  new SlashCommandBuilder()
    .setName('retirerole')
    .setDescription('Retire manuellement un rôle temporaire avant expiration')
    .addUserOption(o =>
      o.setName('utilisateur').setDescription('L\'utilisateur cible').setRequired(true))
    .addRoleOption(o =>
      o.setName('role').setDescription('Le rôle à retirer').setRequired(true)),
].map(c => c.toJSON());

// ─── READY ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Bot connecté : ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('✅ Commandes slash enregistrées');

  // Vérifie les rôles expirés toutes les minutes
  setInterval(() => checkExpiredRoles(), 60 * 1000);
  checkExpiredRoles(); // vérif au démarrage
});

// ─── INTERACTIONS ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Vérification du rôle autorisé
  const hasPermission =
    interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (ALLOWED_ROLE_ID && interaction.member.roles.cache.has(ALLOWED_ROLE_ID));

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.',
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'giverole') {
    await handleGiveRole(interaction);
  } else if (interaction.commandName === 'retirerole') {
    await handleRemoveRole(interaction);
  }
});

// ─── /giverole ─────────────────────────────────────────────────────────────────
async function handleGiveRole(interaction) {
  const target = interaction.options.getMember('utilisateur');
  const role   = interaction.options.getRole('role');
  const duree  = interaction.options.getString('duree');

  if (!target) {
    return interaction.reply({ content: '❌ Utilisateur introuvable sur ce serveur.', ephemeral: true });
  }

  // Calcul expiration
  const durations = { '1d': 1, '1w': 7, '1m': 30 };
  const labels    = { '1d': '1 jour', '1w': '1 semaine', '1m': '1 mois' };
  const expiresAt = new Date(Date.now() + durations[duree] * 24 * 60 * 60 * 1000);

  try {
    // Vérifie si l'entrée existe déjà, sinon crée
    await TempRole.findOneAndUpdate(
      { guildId: interaction.guild.id, userId: target.id, roleId: role.id },
      { expiresAt },
      { upsert: true, new: true },
    );

    await target.roles.add(role);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Rôle temporaire attribué')
      .addFields(
        { name: 'Utilisateur', value: `${target}`, inline: true },
        { name: 'Rôle',        value: `${role}`,   inline: true },
        { name: 'Durée',       value: labels[duree], inline: true },
        { name: 'Expire le',   value: expiresAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), inline: true },
        { name: 'Par',         value: `${interaction.user}`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await sendLog(interaction.guild, embed);

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
  }
}

// ─── /retirerole ───────────────────────────────────────────────────────────────
async function handleRemoveRole(interaction) {
  const target = interaction.options.getMember('utilisateur');
  const role   = interaction.options.getRole('role');

  if (!target) {
    return interaction.reply({ content: '❌ Utilisateur introuvable sur ce serveur.', ephemeral: true });
  }

  try {
    const entry = await TempRole.findOneAndDelete({
      guildId: interaction.guild.id,
      userId:  target.id,
      roleId:  role.id,
    });

    if (!entry) {
      return interaction.reply({
        content: `⚠️ Aucun rôle temporaire **${role.name}** trouvé pour ${target}.`,
        ephemeral: true,
      });
    }

    await target.roles.remove(role);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Rôle temporaire retiré manuellement')
      .addFields(
        { name: 'Utilisateur', value: `${target}`, inline: true },
        { name: 'Rôle',        value: `${role}`,   inline: true },
        { name: 'Retiré par',  value: `${interaction.user}`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await sendLog(interaction.guild, embed);

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
  }
}

// ─── VÉRIFICATION EXPIRATION ───────────────────────────────────────────────────
async function checkExpiredRoles() {
  const expired = await TempRole.find({ expiresAt: { $lte: new Date() } });

  for (const entry of expired) {
    try {
      const guild  = await client.guilds.fetch(entry.guildId);
      const member = await guild.members.fetch(entry.userId).catch(() => null);

      if (member) {
        await member.roles.remove(entry.roleId).catch(() => {});

        const role = guild.roles.cache.get(entry.roleId);
        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('⏰ Rôle temporaire expiré')
          .addFields(
            { name: 'Utilisateur', value: `<@${entry.userId}>`, inline: true },
            { name: 'Rôle',        value: role ? `<@&${entry.roleId}>` : entry.roleId, inline: true },
            { name: 'Expiré le',   value: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), inline: true },
          )
          .setTimestamp();

        await sendLog(guild, embed);
        console.log(`⏰ Rôle expiré retiré à ${entry.userId}`);
      }
    } catch (err) {
      console.error('Erreur retrait rôle expiré:', err);
    }

    await TempRole.deleteOne({ _id: entry._id });
  }
}

// ─── ENVOI LOG ─────────────────────────────────────────────────────────────────
async function sendLog(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Erreur envoi log:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
