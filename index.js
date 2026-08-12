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

// Definición completa del comando /video-search
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos con filtros avanzados en YouTube y TikTok')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('plataforma')
      .setDescription('¿Dónde quieres buscar?')
      .addChoices(
        { name: 'Todas (YouTube y TikTok)', value: 'todas' },
        { name: 'Solo YouTube', value: 'youtube' },
        { name: 'Solo TikTok', value: 'tiktok' }
      ))
  .addStringOption(option =>
    option.setName('duracion')
      .setDescription('Filtrar por duración (solo afecta a YouTube)')
      .addChoices(
        { name: 'Cualquier duración', value: 'any' },
        { name: 'Corto (< 4 minutos)', value: 'short' },
        { name: 'Medio (4 - 20 minutos)', value: 'medium' },
        { name: 'Largo (> 20 minutos)', value: 'long' }
      ))
  .addStringOption(option =>
    option.setName('orden')
      .setDescription('Ordenar resultados')
      .addChoices(
        { name: 'Relevancia', value: 'relevance' },
        { name: 'Más recientes (Fecha)', value: 'date' },
        { name: 'Más vistos', value: 'viewCount' }
      ));

// Evento al iniciar
client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comando /video-search actualizado con filtros!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

// Respuesta al comando
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    const query = interaction.options.getString('busqueda');
    const plataforma = interaction.options.getString('plataforma') || 'todas';
    const duracion = interaction.options.getString('duracion') || 'any';
    const orden = interaction.options.getString('orden') || 'relevance';

    await interaction.deferReply();

    const embed = new EmbedBuilder()
      .setTitle(`Búsqueda: "${query}"`)
      .setColor('#0099FF');

    // 1. YouTube
    if (plataforma === 'todas' || plataforma === 'youtube') {
      try {
        const searchParams = {
          part: ['snippet'],
          q: query,
          maxResults: 3,
          type: ['video'],
          order: orden
        };

        if (duracion !== 'any') {
          searchParams.videoDuration = duracion;
        }

        const ytResponse = await youtube.search.list(searchParams);
        const ytItems = ytResponse.data.items || [];

        if (ytItems.length > 0) {
          let ytText = '';
          ytItems.forEach(item => {
            ytText += `• [${item.snippet.title}](https://www.youtube.com/watch?v=${item.id.videoId})\n`;
          });
          embed.addFields({ name: '🔴 YouTube', value: ytText });
        } else {
          embed.addFields({ name: '🔴 YouTube', value: 'Sin resultados con esos filtros.' });
        }
      } catch (err) {
        console.error('Error YouTube:', err);
        embed.addFields({ name: '🔴 YouTube', value: 'Error en la búsqueda.' });
      }
    }

    // 2. TikTok
    if (plataforma === 'todas' || plataforma === 'tiktok') {
      try {
        const searchFn = tiktokSearch.search || tiktokSearch;
        const ttResults = await searchFn(query, { limit: 3 });

        if (ttResults && ttResults.length > 0) {
          let ttText = '';
          ttResults.forEach(item => {
            const videoLink = item.play || item.webVideoUrl || `https://www.tiktok.com`;
            const title = item.title || 'Vídeo de TikTok';
            ttText += `• [${title.slice(0, 45)}...](${videoLink})\n`;
          });
          embed.addFields({ name: '🎵 TikTok', value: ttText });
        } else {
          embed.addFields({ name: '🎵 TikTok', value: 'Sin resultados.' });
        }
      } catch (err) {
        console.error('Error TikTok:', err);
        embed.addFields({ name: '🎵 TikTok', value: 'No disponible en este momento.' });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
