import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';
import tiktokSearch from 'tiktok-search-api';

// Servidor web de apoyo para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${port}`));

// Clientes
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Comando /video-search
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok por nombre')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true));

// Evento al iniciar
client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comandos actualizados en Discord!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

// Respuesta al comando
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    const query = interaction.options.getString('busqueda');
    await interaction.deferReply();

    const embed = new EmbedBuilder()
      .setTitle(`Búsqueda: "${query}"`)
      .setColor('#0099FF');

    // YouTube
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
        embed.addFields({ name: '🔴 YouTube', value: 'Sin resultados.' });
      }
    } catch (err) {
      embed.addFields({ name: '🔴 YouTube', value: 'Error en la búsqueda.' });
    }

    // TikTok
    try {
      const searchFn = tiktokSearch.search || tiktokSearch;
      const ttResults = await searchFn(query, { limit: 2 });
      if (ttResults && ttResults.length > 0) {
        let ttText = '';
        ttResults.forEach(item => {
          const videoLink = item.play || item.webVideoUrl || `https://www.tiktok.com`;
          const title = item.title || 'Vídeo de TikTok';
          ttText += `• [${title.slice(0, 40)}...](${videoLink})\n`;
        });
        embed.addFields({ name: '🎵 TikTok', value: ttText });
      } else {
        embed.addFields({ name: '🎵 TikTok', value: 'Sin resultados.' });
      }
    } catch (err) {
      embed.addFields({ name: '🎵 TikTok', value: 'No disponible en este momento.' });
    }

    await interaction.editReply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
