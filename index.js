import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// Servidor de apoyo para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${port}`));

// Cliente Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- FUNCIONES AUXILIARES DE FILTRADO ---

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

function formatDateForApi(value, endOfDay) {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  
  const [_, year, month, day] = match;
  return `${year}-${month}-${day}T${endOfDay ? '23:59:59Z' : '00:00:00Z'}`;
}

async function searchYouTube(options) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { results: [], error: "No se ha configurado YOUTUBE_API_KEY en Render." };

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "50");
    searchUrl.searchParams.set("q", options.name);
    searchUrl.searchParams.set("key", apiKey);

    const afterBoundary = formatDateForApi(options.after, false);
    const beforeBoundary = formatDateForApi(options.before, true);
    if (afterBoundary) searchUrl.searchParams.set("publishedAfter", afterBoundary);
    if (beforeBoundary) searchUrl.searchParams.set("publishedBefore", beforeBoundary);

    const response = await fetch(searchUrl.toString());
    const data = await response.json();

    if (!response.ok) {
      return { results: [], error: `Google API (${response.status}): ${data.error?.message || 'Error en búsqueda'}` };
    }

    const ids = (data.items ?? []).map((item) => item.id?.videoId).filter(Boolean);
    if (ids.length === 0) return { results: [] };

    // Pedir detalles de duración a la API
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,contentDetails");
    videosUrl.searchParams.set("id", ids.join(","));
    videosUrl.searchParams.set("key", apiKey);

    const videoResponse = await fetch(videosUrl.toString());
    const videoData = await videoResponse.json();

    if (!videoResponse.ok) {
      return { results: [], error: `Google API Details (${videoResponse.status}): ${videoData.error?.message || 'Error en detalles'}` };
    }

    // Filtrado exhaustivo exacto al de Replit
    const filteredResults = (videoData.items ?? []).map((item) => {
      if (!item.id || !item.snippet?.title) return null;
      return {
        title: item.snippet.title,
        creator: item.snippet.channelTitle || 'Canal desconocido',
        durationSeconds: parseIsoDuration(item.contentDetails?.duration),
        url: `https://www.youtube.com/watch?v=${item.id}`
      };
    }).filter((item) => {
      if (!item) return false;

      // Creador
      if (options.creator) {
        if (!item.creator.toLowerCase().includes(options.creator.toLowerCase())) return false;
      }

      // Palabras excluidas
      if (options.excludedTerms && options.excludedTerms.length > 0) {
        const fullText = normalizeSearchText(`${item.title} ${item.creator}`);
        for (const term of options.excludedTerms) {
          const cleanTerm = normalizeSearchText(term);
          if (cleanTerm && fullText.includes(cleanTerm)) return false;
        }
      }

      // Duración mínima y máxima
      if (options.minSeconds !== undefined) {
        if (item.durationSeconds === undefined || item.durationSeconds < options.minSeconds) return false;
      }
      if (options.maxSeconds !== undefined) {
        if (item.durationSeconds === undefined || item.durationSeconds > options.maxSeconds) return false;
      }

      return true;
    }).slice(0, 10);

    return { results: filteredResults };

  } catch (err) {
    return { results: [], error: `Error de conexión: ${err.message}` };
  }
}

// --- REGISTRO DEL COMANDO COMPLETO ---

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
    console.log('¡Comando /video-search registrado por completo!');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    try {
      // 1. Responder inmediatamente a Discord
      await interaction.deferReply();

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
      const excludedTerms = exclude ? exclude.split(/[\s,]+/).filter(Boolean) : [];

      const options = {
        name,
        creator: creator?.trim() || undefined,
        minSeconds,
        maxSeconds,
        after: after?.trim() || undefined,
        before: before?.trim() || undefined,
        excludedTerms
      };

      const embed = new EmbedBuilder()
        .setTitle(`Búsqueda: "${name}"`)
        .setColor('#0099FF');

      // 2. Ejecutar YouTube
      if (platform === 'both' || platform === 'youtube') {
        const ytData = await searchYouTube(options);

        if (ytData.error) {
          embed.addFields({ name: '🔴 YouTube', value: `⚠️ ${ytData.error}` });
        } else if (ytData.results && ytData.results.length > 0) {
          let ytText = '';
          ytData.results.forEach(item => {
            ytText += `• [${item.title}](${item.url}) — *${item.creator}*\n`;
          });
          embed.addFields({ name: '🔴 YouTube', value: ytText });
        } else {
          embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron resultados con los filtros aplicados.' });
        }
      }

      // 3. Ejecutar TikTok
      if (platform === 'both' || platform === 'tiktok') {
        const tiktokSearchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(name)}`;
        embed.addFields({ 
          name: '🎵 TikTok', 
          value: `• [Buscar "${name}" en TikTok](${tiktokSearchUrl})\n*(Lista completa al abrir el enlace)*` 
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en la interacción:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`Se ha producido un error al procesar la orden: ${err.message}`);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
