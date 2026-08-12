import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(process.env.PORT || 3000);
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';

// Configuración de clientes
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Definición del comando /video-search
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube por nombre')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true));

// Registrar el comando en Discord al encender
client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Cargando comando /video-search en Discord...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comando registrado con éxito!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

// Respuesta al ejecutar el comando
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    const query = interaction.options.getString('busqueda');
    await interaction.deferReply();

    try {
      // Búsqueda usando la API oficial de YouTube
      const response = await youtube.search.list({
        part: ['snippet'],
        q: query,
        maxResults: 3,
        type: ['video']
      });

      const items = response.data.items;

      if (!items || items.length === 0) {
        return interaction.editReply(`No he encontrado ningún vídeo para: "${query}".`);
      }

      // Preparar el mensaje de respuesta
      const embed = new EmbedBuilder()
        .setTitle(`Resultados de YouTube para: ${query}`)
        .setColor('#FF0000');

      items.forEach(item => {
        const title = item.snippet.title;
        const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
        const channel = item.snippet.channelTitle;
        embed.addFields({ name: title, value: `Canal: ${channel}\n[Ver vídeo](${videoUrl})` });
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en la búsqueda de YouTube:', error);
      await interaction.editReply('Hubo un error al conectar con la API de YouTube.');
    }
  }
});

// Conectar el bot
client.login(process.env.DISCORD_TOKEN);
