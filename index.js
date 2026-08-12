import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';

// Servidor web para Render
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

// Comando /video-search actualizado
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok con filtros precisos')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('excluir')
      .setDescription('Palabras que NO quieres que aparezcan (separadas por espacio)'))
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
      .setDescription('Filtrar por duración (solo YouTube)')
      .addChoices(
        { name: 'Corto (< 4 minutos)', value: 'short' },
        { name: 'Medio (4 - 20 minutos)', value: 'medium' },
        { name: 'Largo (> 20 minutos)', value: 'long' }
      ))
  .addStringOption(option =>
    option.setName('orden')
      .setDescription('Ordenar resultados')
      .addChoices(
        { name: 'Más relevantes (por defecto)', value: 'relevance' },
        { name: 'Más recientes (Fecha)', value: 'date' },
        { name: 'Más vistos', value: 'viewCount' }
      ));

// Registrar comandos al iniciar
client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comando /video-search actualizado!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

// Respuesta al comando
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    const rawQuery = interaction.options.getString('busqueda');
    const excluir = interaction.options.getString('excluir');
    const plataforma = interaction.options.getString('plataforma') || 'todas';
    const duracion = interaction.options.getString('duracion');
    const orden = interaction.options.getString('orden') || 'relevance';

    await interaction.deferReply();

    // Construir la búsqueda de YouTube (si pones "excluir", la API de Google usa el signo de menos "-")
    let finalYtQuery = rawQuery;
    if (excluir) {
      const wordsToExclude = excluir.split(' ').map(w => `-${w}`).join(' ');
      finalYtQuery = `${rawQuery} ${wordsToExclude}`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Búsqueda: "${rawQuery}"`)
      .setColor('#0099FF');

    if (excluir) {
      embed.setDescription(`Excluyendo palabras: *${excluir}*`);
    }

    // 1. YouTube
    if (plataforma === 'todas' || plataforma === 'youtube') {
      try {
        const searchParams = {
          part: ['snippet'],
          q: finalYtQuery,
          maxResults: 3,
          type: ['video'],
          order: orden
        };

        // Solo se añade la duración si la has elegido expresamente
        if (duracion) {
          searchParams.videoDuration = duracion;
        }

        const ytResponse = await youtube.search.list(searchParams);
        const ytItems = ytResponse.data.items || [];

        if (ytItems.length > 0) {
          let ytText = '';
          ytItems.forEach(item => {
            const title = item.snippet.title;
            const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
            ytText += `• [${title}](${videoUrl})\n`;
          });
          embed.addFields({ name: '🔴 YouTube', value: ytText });
        } else {
          embed.addFields({ name: '🔴 YouTube', value: 'Sin resultados con esos criterios.' });
        }
      } catch (err) {
        console.error('Error YouTube:', err);
        embed.addFields({ name: '🔴 YouTube', value: 'Error en la búsqueda de YouTube.' });
      }
    }

    // 2. TikTok (Búsqueda por enlace directo formateado)
    if (plataforma === 'todas' || plataforma === 'tiktok') {
      try {
        const encodedQuery = encodeURIComponent(rawQuery);
        const tiktokSearchUrl = `https://www.tiktok.com/search?q=${encodedQuery}`;
        
        embed.addFields({ 
          name: '🎵 TikTok', 
          value: `• [Ver resultados directo en TikTok para "${rawQuery}"](${tiktokSearchUrl})\n*(TikTok bloquea las búsquedas automáticas desde servidores en la nube, pero puedes ver la lista completa con este enlace directo)*` 
        });
      } catch (err) {
        embed.addFields({ name: '🎵 TikTok', value: 'No disponible en este momento.' });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
