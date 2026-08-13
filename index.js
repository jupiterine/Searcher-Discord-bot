import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor en puerto ${port}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Prueba basica')
  .addStringOption(option => 
    option.setName('name')
      .setDescription('Nombre')
      .setRequired(true));

client.once('ready', async () => {
  console.log(`Bot listo: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
  } catch (e) {
    console.error(e);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    // Respuesta directa en menos de 100ms
    const name = interaction.options.getString('name');
    await interaction.reply(`¡Hola! Has buscado: **${name}**. El bot responde correctamente.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
