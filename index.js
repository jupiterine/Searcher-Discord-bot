import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// Servidor de apoyo para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${port}`));

// Cliente Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function normalizeSearchText(value) {
  if (!value) return '';
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

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

async function searchYouTube(options) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { results: [], error: "Falta la clave YOUTUBE_API_KEY en Render." };

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "25");
    searchUrl.searchParams.set("q", options.name);
    searchUrl.searchParams.set("key", apiKey);

    const response = await fetch(searchUrl.toString());
    const data = await response.json();

    if (!response.ok) {
      return { results: [], error: `Google API (${response.status}): ${data.error?.message || 'Error'}` };
    }

    const ids = (data.items ?? []).map((item) => item.id?.videoId).filter(Boolean);
    if (ids.length === 0) return { results: [] };

    // Si ha pedido filtrar por duración, obtenemos los detalles del vídeo
    let durationMap = {};
    if (options.minSeconds !== undefined || options.maxSeconds !== undefined) {
      const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      videosUrl.searchParams.set("part", "contentDetails");
      videosUrl.searchParams.set("id", ids.join(","));
      videosUrl.searchParams.set("key", apiKey);

      const videoResponse = await fetch(videosUrl.toString());
      const videoData = await videoResponse.json();

      if (videoResponse.ok && videoData.items) {
        videoData.items.forEach(v => {
          durationMap[v.id] = parseIsoDuration(v.contentDetails?.duration);
        });
      }
    }

    // Filtrar por exclusión, creador y duración
    const filteredResults = (data.items ?? []).map((item) => {
      const vId = item.id?.videoId;
      if (!vId || !item.snippet?.title) return null;
      return {
        title: item.snippet.title,
        creator: item.snippet.channelTitle || 'Canal desconocido',
        durationSeconds: durationMap[vId],
        url: `https://www.youtube.com/watch?v=${vId}`
      };
    }).filter((item) => {
      if (!item) return false;

      // Creador
      if (options.creator) {
        if (!item.creator.toLowerCase().includes(options.creator.toLowerCase())) return false;
      }

      // Palabras a excluir
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
    return { results: [], error: `Error: ${err.message}` };
  }
}

// --- REGISTRO DEL COMANDO ---

const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok')
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
    console.log('¡Comando registrado con éxito!');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    // 1. Responder de inmediato a Discord para evitar que salte el error de tiempo
    await interaction.deferReply();

    try {
      const name = interaction.options.getString('name');
      const platform = interaction.options.getString('platform') || 'both';
      const minLength = interaction.options.getInteger('min_length');
      const maxLength = interaction.options.getInteger('max_length');
      const exclude = interaction.options.getString('exclude');
      const creator = interaction.options.getString('creator');

      const minSeconds = (minLength !== null && minLength !== undefined) ? minLength * 60 : undefined;
      const maxSeconds = (maxLength !== null && maxLength !== undefined) ? maxLength * 60 : undefined;
      const excludedTerms = exclude ? exclude.split(/[\s,]+/).filter(Boolean) : [];

      const options = {
        name,
        creator: creator?.trim() || undefined,
        minSeconds,
        maxSeconds,
        excludedTerms
      };

      const embed = new EmbedBuilder()
        .setTitle(`Búsqueda: "${name}"`)
        .setColor('#0099FF');

      // YouTube
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
          embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron resultados con esos criterios.' });
        }
      }

      // TikTok
      if (platform === 'both' || platform === 'tiktok') {
        const tiktokSearchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(name)}`;
        embed.addFields({ 
          name: '🎵 TikTok', 
          value: `• [Buscar "${name}" en TikTok](${tiktokSearchUrl})\n*(Verás la lista completa al hacer clic)*` 
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error procesando interacción:', err);
      await interaction.editReply('Se produjo un error al realizar la búsqueda.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
