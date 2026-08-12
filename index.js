import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';
import tiktokSearch from 'tiktok-search-api';

// Servidor web para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor web escuchando en puerto ${port}`));

// Configuración de clientes
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Definición del comando /video-search
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok por nombre')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true));

// Registrar el comando al encender
client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
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

    const embed = new EmbedBuilder()
      .setTitle(`Resultados de búsqueda para: "${query}"`)
      .setColor('#0099FF');

    // 1. Búsqueda en YouTube
    try {
      const ytResponse = await youtube.search.list({
        part: ['snippet'],
        q: query,
        maxResults: 2,
        type: ['video']
      });

      const ytItems = ytResponse.data.items || [];
      if (ytItems.length > 0) {
        let ytText = '';
        ytItems.forEach(item => {
          ytText += `• [${item.snippet.title}](https://www.youtube.com/watch?v=${item.id.videoId})\n`;
        });
        embed.addFields({ name: '🔴 YouTube', value: ytText });
      } else {
        embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron vídeos.' });
      }
    } catch (err) {
      console.error('Error YouTube:', err);
      embed.addFields({ name: '🔴 YouTube', value: 'Error al conectar con la API.' });
    }

    // 2. Búsqueda en TikTok (Scraping)
    try {
      const ttResults = await tiktokSearch.search(query, { limit: 2 });
      if (ttResults && ttResults.length > 0) {
        let ttText = '';
        ttResults.forEach(item => {
          const videoLink = item.play || item.webVideoUrl || `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`;
          const title = item.title || 'Vídeo de TikTok';
          ttText += `• [${title.slice(0, 50)}...](${videoLink})\n`;
        });
        embed.addFields({ name: '🎵 TikTok', value: ttText });
      } else {
        embed.addFields({ name: '🎵 TikTok', value: 'No se encontraron resultados.' });
      }
    } catch (err) {
      console.error('Error TikTok:', err);
      embed.addFields({ name: '🎵 TikTok', value: 'No se pudieron obtener resultados en este momento.' });
    }

    await interaction.editReply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
