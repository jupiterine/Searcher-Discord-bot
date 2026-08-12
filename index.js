import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// Servidor de apoyo para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${port}`));

// Cliente Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- FUNCIONES AUXILIARES Y FILTROS SEGUROS ---

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
  if (!value) return '';
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Formateador corregido y compatible al 100% con la API de YouTube
function dateBoundary(value, endOfDay) {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  
  // Extraer sólo los números de AAAA-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const [_, year, month, day] = match;
  const timeStr = endOfDay ? "23:59:59Z" : "00:00:00Z";
  return `${year}-${month}-${day}T${timeStr}`;
}

function matchesFilters(result, options) {
  if (!result) return false;

  // Creador
  if (options.creator && options.creator.trim() !== '') {
    const targetCreator = options.creator.trim().toLowerCase();
    if (!result.creator || !result.creator.toLowerCase().includes(targetCreator)) {
      return false;
    }
  }

  // Palabras excluidas
  if (options.excludedTerms && options.excludedTerms.length > 0) {
    const resultText = normalizeSearchText(`${result.title ?? ''} ${result.creator ?? ''}`);
    for (const term of options.excludedTerms) {
      const cleanTerm = normalizeSearchText(term);
      if (cleanTerm && resultText.includes(cleanTerm)) {
        return false;
      }
    }
  }

  // Duración mínima
  if (options.minSeconds !== undefined) {
    if (result.durationSeconds === undefined || result.durationSeconds < options.minSeconds) {
      return false;
    }
  }

  // Duración máxima
  if (options.maxSeconds !== undefined) {
    if (result.durationSeconds === undefined || result.durationSeconds > options.maxSeconds) {
      return false;
    }
  }

  // Fechas (after / before)
  if (options.after || options.before) {
    if (!result.publishedAt) return false;
    const published = Date.parse(result.publishedAt);
    if (isNaN(published)) return false;

    if (options.after) {
      const afterStr = dateBoundary(options.after, false);
      if (afterStr) {
        const afterParsed = Date.parse(afterStr);
        if (!isNaN(afterParsed) && published < afterParsed) return false;
      }
    }

    if (options.before) {
      const beforeStr = dateBoundary(options.before, true);
      if (beforeStr) {
        const beforeParsed = Date.parse(beforeStr);
        if (!isNaN(beforeParsed) && published > beforeParsed) return false;
      }
    }
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
    searchUrl.searchParams.set("maxResults", "50");
    searchUrl.searchParams.set("q", options.name);
    searchUrl.searchParams.set("key", apiKey);

    const afterBoundary = dateBoundary(options.after, false);
    const beforeBoundary = dateBoundary(options.before, true);
    if (afterBoundary) searchUrl.searchParams.set("publishedAfter", afterBoundary);
    if (beforeBoundary) searchUrl.searchParams.set("publishedBefore", beforeBoundary);

    const response = await fetch(searchUrl.toString());
    if (!response.ok) {
      console.error(`Error HTTP en YouTube search: ${response.status}`);
      return { provider: "YouTube", results: [] };
    }
    const searchData = await response.json();

    const ids = (searchData.items ?? [])
      .map((item) => item.id?.videoId)
      .filter(Boolean);

    if (ids.length === 0) return { provider: "YouTube", results: [] };

    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,contentDetails");
    videosUrl.searchParams.set("id", ids.join(","));
    videosUrl.searchParams.set("key", apiKey);

    const videoResponse = await fetch(videosUrl.toString());
    if (!videoResponse.ok) {
      console.error(`Error HTTP en YouTube videos: ${videoResponse.status}`);
      return { provider: "YouTube", results: [] };
    }
    const videoData = await videoResponse.json();

    const results = (videoData.items ?? [])
      .map((item) => {
        if (!item.id || !item.snippet?.title || !item.snippet?.channelTitle) return undefined;
        return {
          platform: "YouTube",
          title: item.snippet.title,
          creator: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
          durationSeconds: parseIsoDuration(item.contentDetails?.duration),
          url: `https://www.youtube.com/watch?v=${item.id}`,
        };
      })
      .filter(Boolean)
      .filter((result) => matchesFilters(result, options))
      .slice(0, 10);

    return { provider: "YouTube", results };
  } catch (error) {
    console.error("Error en searchYouTube:", error);
    return { provider: "YouTube", results: [] };
  }
}

// --- CONFIGURACIÓN DEL COMANDO DISCORD ---

const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok con filtros avanzados')
  .addStringOption(option => 
    option.setName('name')
      .setDescription('Nombre o término a buscar')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('platform')
      .setDescription('Plataforma donde buscar')
      .addChoices(
        { name: 'Todas (YouTube y TikTok)', value: 'both' },
        { name: 'Solo YouTube', value: 'youtube' },
        { name: 'Solo TikTok', value: 'tiktok' }
      ))
  .addIntegerOption(option =>
    option.setName('min_length')
      .setDescription('Duración mínima en minutos'))
  .addIntegerOption(option =>
    option.setName('max_length')
      .setDescription('Duración máxima en minutos'))
  .addStringOption(option =>
    option.setName('exclude')
      .setDescription('Palabras a excluir (separadas por espacio)'))
  .addStringOption(option =>
    option.setName('after')
      .setDescription('Publicado después de esta fecha (AAAA-MM-DD)'))
  .addStringOption(option =>
    option.setName('before')
      .setDescription('Publicado antes de esta fecha (AAAA-MM-DD)'))
  .addStringOption(option =>
    option.setName('creator')
      .setDescription('Nombre del canal/creador'));

client.once('ready', async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('¡Comandos actualizados con éxito!');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    await interaction.deferReply();

    try {
      const name = interaction.options.getString('name');
      const platform = interaction.options.getString('platform') || 'both';
      const minLength = interaction.options.getInteger('min_length');
      const maxLength = interaction.options.getInteger('max_length');
      const exclude = interaction.options.getString('exclude');
      const after = interaction.options.getString('after');
      const before = interaction.options.getString('before');
      const creator = interaction.options.getString('creator');

      const minSeconds = (minLength !== null && minLength !== undefined) ? minLength * 60 : undefined;
      const maxSeconds = (maxLength !== null && maxLength !== undefined) ? maxLength * 60 : undefined;
      const excludedTerms = exclude ? exclude.split(/[\s,]+/).filter(Boolean) : undefined;

      const options = {
        name,
        creator: creator || undefined,
        minSeconds,
        maxSeconds,
        after: after || undefined,
        before: before || undefined,
        excludedTerms
      };

      const embed = new EmbedBuilder()
        .setTitle(`Búsqueda: "${name}"`)
        .setColor('#0099FF');

      // YouTube
      if (platform === 'both' || platform === 'youtube') {
        const ytData = await searchYouTube(options);
        if (ytData.results && ytData.results.length > 0) {
          let ytText = '';
          ytData.results.forEach(item => {
            ytText += `• [${item.title}](${item.url}) — *${item.creator}*\n`;
          });
          embed.addFields({ name: '🔴 YouTube', value: ytText });
        } else {
          embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron resultados con los filtros aplicados.' });
        }
      }

      // TikTok
      if (platform === 'both' || platform === 'tiktok') {
        const tiktokSearchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(name)}`;
        embed.addFields({ 
          name: '🎵 TikTok', 
          value: `• [Buscar "${name}" directamente en TikTok](${tiktokSearchUrl})\n*(Lista completa al abrir el enlace)*` 
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error procesando interacción:', err);
      await interaction.editReply('Ocurrió un error al procesar la búsqueda. Por favor, verifica el formato de los parámetros (ej. fecha AAAA-MM-DD).');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
