import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor en puerto ${port}`));

// Protecciones globales para que NUNCA se apague el proceso
process.on('unhandledRejection', (reason) => console.error('Error no capturado:', reason));
process.on('uncaughtException', (err) => console.error('Excepción no capturada:', err));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (err) => console.error('Error de cliente Discord:', err));

function normalizeSearchText(value) {
  if (!value) return '';
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function searchYouTube(options) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { results: [], error: "Falta YOUTUBE_API_KEY en Render." };

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
      return { results: [], error: `Google API Error (${response.status}): ${data.error?.message || 'Error en la petición'}` };
    }

    const items = data.items || [];
    const results = items
      .map(item => {
        if (!item.id?.videoId || !item.snippet?.title) return null;
        return {
          title: item.snippet.title,
          creator: item.snippet.channelTitle || 'Canal desconocido',
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        };
      })
      .filter(Boolean)
      .filter(item => {
        // Creador
        if (options.creator && !item.creator.toLowerCase().includes(options.creator.toLowerCase())) {
          return false;
        }
        // Excluir palabras
        if (options.excludedTerms && options.excludedTerms.length > 0) {
          const fullText = normalizeSearchText(`${item.title} ${item.creator}`);
          for (const term of options.excludedTerms) {
            const cleanTerm = normalizeSearchText(term);
            if (cleanTerm && fullText.includes(cleanTerm)) return false;
          }
        }
        return true;
      })
      .slice(0, 10);

    return { results };
  } catch (err) {
    return { results: [], error: `Fallo de conexión: ${err.message}` };
  }
}

// Registro de comandos
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca vídeos en YouTube y TikTok con filtros')
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
  .addStringOption(option =>
    option.setName('exclude')
      .setDescription('Palabras a excluir (separadas por espacio)'))
  .addStringOption(option =>
    option.setName('creator')
      .setDescription('Nombre del canal/creador'));

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('Comandos registrados con éxito');
  } catch (e) {
    console.error('Error registrando comandos:', e);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    // 1. Decirle a Discord inmediatamente que el bot está procesando
    try {
      await interaction.deferReply();
    } catch (e) {
      console.error("Error al diferir respuesta:", e);
      return;
    }

    try {
      const name = interaction.options.getString('name');
      const platform = interaction.options.getString('platform') || 'both';
      const exclude = interaction.options.getString('exclude');
      const creator = interaction.options.getString('creator');

      const excludedTerms = exclude ? exclude.split(/[\s,]+/).filter(Boolean) : [];

      const options = {
        name,
        creator: creator?.trim() || undefined,
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

      // 2. Editar el mensaje de "Searcher está pensando..." con los resultados finales
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error procesando la orden:', err);
      await interaction.editReply(`❌ Ocurrió un fallo al buscar: ${err.message}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
