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
          { name: '2 weeks',  value: '2w'  },
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

  new SlashCommandBuilder()
    .setName('checkrole')
    .setDescription('Check remaining time on temporary roles for a user')
    .addUserOption(o =>
      o.setName('user').setDescription('The user to check (defaults to yourself)').setRequired(false)),

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

  if (interaction.commandName === 'checkrole') {
    // /checkrole is usable by everyone — no permission check needed
    return handleCheckRole(interaction);
  }

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

  const durations = { '1d': 1, '2d': 2, '1w': 7, '2w': 14, '1m': 30, '2mo': 60, '3mo': 90, '1y': 365 };
  const labels    = { '1d': '1 day', '2d': '2 days', '1w': '1 week', '2w': '2 weeks', '1m': '1 month', '2mo': '2 months', '3mo': '3 months', '1y': '1 year' };
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

// ─── /checkrole ────────────────────────────────────────────────────────────────
async function handleCheckRole(interaction) {
  // If a user option is provided, only admins / allowed role can check others
  const targetOption = interaction.options.getMember('user');
  const isSelf = !targetOption || targetOption.id === interaction.member.id;

  if (!isSelf) {
    const hasPermission =
      interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      (ALLOWED_ROLE_ID && interaction.member.roles.cache.has(ALLOWED_ROLE_ID));

    if (!hasPermission) {
      return interaction.reply({
        content: '❌ You do not have permission to check other users\' roles.',
        ephemeral: true,
      });
    }
  }

  const target = targetOption || interaction.member;

  try {
    const entries = await TempRole.find({
      guildId: interaction.guild.id,
      userId:  target.id,
    });

    if (entries.length === 0) {
      return interaction.reply({
        content: `ℹ️ ${isSelf ? 'You have' : `${target} has`} no active temporary roles.`,
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🕐 Active Temporary Roles — ${target.displayName}`)
      .setTimestamp();

    for (const entry of entries) {
      const role = interaction.guild.roles.cache.get(entry.roleId);
      const roleName = role ? `<@&${entry.roleId}>` : `Unknown role (${entry.roleId})`;

      const now       = Date.now();
      const expiresAt = entry.expiresAt.getTime();
      const diffMs    = expiresAt - now;

      let timeLeft;
      if (diffMs <= 0) {
        timeLeft = '⚠️ Expires very soon (pending cleanup)';
      } else {
        timeLeft = formatDuration(diffMs);
      }

      const expiresOn = entry.expiresAt.toLocaleDateString('en-GB', {
        day:   '2-digit',
        month: 'long',
        year:  'numeric',
      });

      embed.addFields({
        name:   roleName,
        value:  `⏳ **Time left:** ${timeLeft}\n📅 **Expires on:** ${expiresOn}`,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
  }
}

// ─── FORMAT DURATION ───────────────────────────────────────────────────────────
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days    > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours   > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (parts.length === 0) parts.push('less than a minute');

  return parts.join(', ');
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
