import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// Servidor de apoyo para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${port}`));

// Discord Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- FUNCIONES DE FILTRADO Y LÓGICA DE REPLIT ---

function parseIsoDuration(value) {
  if (!value) return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

function normalizeSearchText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matchesFilters(result, options) {
  const creator = options.creator?.trim().toLowerCase();
  if (creator && !result.creator.toLowerCase().includes(creator)) return false;

  const resultText = normalizeSearchText(`${result.title} ${result.creator}`);
  if (
    options.excludedTerms?.some((term) =>
      resultText.includes(normalizeSearchText(term))
    )
  ) {
    return false;
  }

  if (
    options.minSeconds !== undefined &&
    (result.durationSeconds === undefined || result.durationSeconds < options.minSeconds)
  ) {
    return false;
  }

  if (
    options.maxSeconds !== undefined &&
    (result.durationSeconds === undefined || result.durationSeconds > options.maxSeconds)
  ) {
    return false;
  }

  return true;
}

async function searchYouTube(options) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { provider: "YouTube", results: [] };

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "50"); // Pedimos 50 para filtrar con margen
    searchUrl.searchParams.set("q", options.name);
    searchUrl.searchParams.set("key", apiKey);

    const response = await fetch(searchUrl.toString());
    const searchData = await response.json();

    const ids = (searchData.items ?? [])
      .map((item) => item.id?.videoId)
      .filter(Boolean);

    if (ids.length === 0) return { provider: "YouTube", results: [] };

    // Pedimos detalles de duración a la API
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,contentDetails");
    videosUrl.searchParams.set("id", ids.join(","));
    videosUrl.searchParams.set("key", apiKey);

    const videoResponse = await fetch(videosUrl.toString());
    const videoData = await videoResponse.json();

    // Aplicamos el filtro estricto de Replit
    const results = (videoData.items ?? [])
      .map((item) => {
        if (!item.id || !item.snippet?.title || !item.snippet.channelTitle) return undefined;
        return {
          platform: "YouTube",
          title: item.snippet.title,
          creator: item.snippet.channelTitle,
          durationSeconds: parseIsoDuration(item.contentDetails?.duration),
          url: `https://www.youtube.com/watch?v=${item.id}`,
        };
      })
      .filter(Boolean)
      .filter((result) => matchesFilters(result, options))
      .slice(0, 5); // Mostramos los 5 mejores filtrados

    return { provider: "YouTube", results };
  } catch (error) {
    console.error("YouTube search error:", error);
    return { provider: "YouTube", results: [] };
  }
}

// --- CONFIGURACIÓN DEL COMANDO DE DISCORD ---

const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube con filtros precisos')
  .addStringOption(option => 
    option.setName('busqueda')
      .setDescription('Nombre o término a buscar')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('excluir')
      .setDescription('Palabras a excluir (separadas por espacio)'))
  .addStringOption(option =>
    option.setName('creador')
      .setDescription('Nombre del canal/creador'))
  .addStringOption(option =>
    option.setName('duracion')
      .setDescription('Filtrar por duración')
      .addChoices(
        { name: 'Corto (< 4 minutos)', value: 'short' },
        { name: 'Medio (4 - 20 minutos)', value: 'medium' },
        { name: 'Largo (> 20 minutos)', value: 'long' }
      ));

client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comando /video-search actualizado en Discord!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    const rawQuery = interaction.options.getString('busqueda');
    const excluir = interaction.options.getString('excluir');
    const creador = interaction.options.getString('creador');
    const duracionOption = interaction.options.getString('duracion');

    await interaction.deferReply();

    // Rango de segundos según la opción elegida
    let minSeconds;
    let maxSeconds;
    if (duracionOption === 'short') { maxSeconds = 240; }
    else if (duracionOption === 'medium') { minSeconds = 240; maxSeconds = 1200; }
    else if (duracionOption === 'long') { minSeconds = 1200; }

    const options = {
      name: rawQuery,
      creator: creador || undefined,
      minSeconds,
      maxSeconds,
      excludedTerms: excluir ? excluir.split(' ') : undefined
    };

    const embed = new EmbedBuilder()
      .setTitle(`Resultados para: "${rawQuery}"`)
      .setColor('#FF0000');

    if (excluir) embed.addFields({ name: '🚫 Palabras excluidas', value: excluir });
    if (creador) embed.addFields({ name: '👤 Creador', value: creador });

    const ytData = await searchYouTube(options);

    if (ytData.results.length > 0) {
      let ytText = '';
      ytData.results.forEach(item => {
        ytText += `• [${item.title}](${item.url}) — *${item.creator}*\n`;
      });
      embed.addFields({ name: '🔴 YouTube', value: ytText });
    } else {
      embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron resultados que cumplan todos los filtros.' });
    }

    // Enlace a TikTok
    const tiktokSearchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(rawQuery)}`;
    embed.addFields({ 
      name: '🎵 TikTok', 
      value: `• [Buscar "${rawQuery}" directamente en TikTok](${tiktokSearchUrl})\n*(TikTok no permite búsquedas automatizadas sin API oficial)*` 
    });

    await interaction.editReply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
