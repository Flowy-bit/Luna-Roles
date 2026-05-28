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
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;
const LOG_CHANNEL_ID  = process.env.LOG_CHANNEL_ID;
// ───────────────────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const TempRole = mongoose.model('TempRole', new mongoose.Schema({
  guildId:   String,
  userId:    String,
  roleId:    String,
  expiresAt: Date,
}));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ─── SLASH COMMANDS ────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('Grant a temporary role to a user')
    .addUserOption(o =>
      o.setName('user').setDescription('The target user').setRequired(true))
    .addRoleOption(o =>
      o.setName('role').setDescription('The role to assign').setRequired(true))
    .addStringOption(o =>
      o.setName('duration').setDescription('Role duration').setRequired(true)
        .addChoices(
          { name: '1 day',    value: '1d'  },
          { name: '2 days',   value: '2d'  },
          { name: '1 week',   value: '1w'  },
          { name: '1 month',  value: '1m'  },
          { name: '2 months', value: '2mo' },
          { name: '3 months', value: '3mo' },
          { name: '1 year',   value: '1y'  },
        )),

  new SlashCommandBuilder()
    .setName('removerole')
    .setDescription('Manually remove a temporary role before it expires')
    .addUserOption(o =>
      o.setName('user').setDescription('The target user').setRequired(true))
    .addRoleOption(o =>
      o.setName('role').setDescription('The role to remove').setRequired(true)),
].map(c => c.toJSON());

// ─── READY ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Bot logged in: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('✅ Slash commands registered');

  setInterval(() => checkExpiredRoles(), 60 * 1000);
  checkExpiredRoles();
});

// ─── INTERACTIONS ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const hasPermission =
    interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (ALLOWED_ROLE_ID && interaction.member.roles.cache.has(ALLOWED_ROLE_ID));

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ You do not have permission to use this command.',
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'giverole') {
    await handleGiveRole(interaction);
  } else if (interaction.commandName === 'removerole') {
    await handleRemoveRole(interaction);
  }
});

// ─── /giverole ─────────────────────────────────────────────────────────────────
async function handleGiveRole(interaction) {
  const target = interaction.options.getMember('user');
  const role   = interaction.options.getRole('role');
  const duree  = interaction.options.getString('duration');

  if (!target) {
    return interaction.reply({ content: '❌ User not found on this server.', ephemeral: true });
  }

  const durations = { '1d': 1, '2d': 2, '1w': 7, '1m': 30, '2mo': 60, '3mo': 90, '1y': 365 };
  const labels    = { '1d': '1 day', '2d': '2 days', '1w': '1 week', '1m': '1 month', '2mo': '2 months', '3mo': '3 months', '1y': '1 year' };
  const expiresAt = new Date(Date.now() + durations[duree] * 24 * 60 * 60 * 1000);

  try {
    await TempRole.findOneAndUpdate(
      { guildId: interaction.guild.id, userId: target.id, roleId: role.id },
      { expiresAt },
      { upsert: true, new: true },
    );

    await target.roles.add(role);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Temporary role assigned')
      .addFields(
        { name: 'User',       value: `${target}`,       inline: true },
        { name: 'Role',       value: `${role}`,         inline: true },
        { name: 'Duration',   value: labels[duree],     inline: true },
        { name: 'Expires on', value: expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), inline: true },
        { name: 'Granted by', value: `${interaction.user}`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await sendLog(interaction.guild, embed);

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
  }
}

// ─── /removerole ───────────────────────────────────────────────────────────────
async function handleRemoveRole(interaction) {
  const target = interaction.options.getMember('user');
  const role   = interaction.options.getRole('role');

  if (!target) {
    return interaction.reply({ content: '❌ User not found on this server.', ephemeral: true });
  }

  try {
    const entry = await TempRole.findOneAndDelete({
      guildId: interaction.guild.id,
      userId:  target.id,
      roleId:  role.id,
    });

    if (!entry) {
      return interaction.reply({
        content: `⚠️ No temporary role **${role.name}** found for ${target}.`,
        ephemeral: true,
      });
    }

    await target.roles.remove(role);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Temporary role manually removed')
      .addFields(
        { name: 'User',       value: `${target}`,           inline: true },
        { name: 'Role',       value: `${role}`,             inline: true },
        { name: 'Removed by', value: `${interaction.user}`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await sendLog(interaction.guild, embed);

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
  }
}

// ─── EXPIRATION CHECK ──────────────────────────────────────────────────────────
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
          .setTitle('⏰ Temporary role expired')
          .addFields(
            { name: 'User',       value: `<@${entry.userId}>`,                         inline: true },
            { name: 'Role',       value: role ? `<@&${entry.roleId}>` : entry.roleId,  inline: true },
            { name: 'Expired on', value: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), inline: true },
          )
          .setTimestamp();

        await sendLog(guild, embed);
        console.log(`⏰ Expired role removed from ${entry.userId}`);
      }
    } catch (err) {
      console.error('Error removing expired role:', err);
    }

    await TempRole.deleteOne({ _id: entry._id });
  }
}

// ─── SEND LOG ──────────────────────────────────────────────────────────────────
async function sendLog(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Error sending log:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
