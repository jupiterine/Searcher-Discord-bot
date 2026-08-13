import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// Servidor de mantenimiento para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, '0.0.0.0', () => console.log(`Servidor en puerto ${port}`));

// Escuchadores globales para impedir que el proceso muera por errores de red
process.on('unhandledRejection', (err) => console.error('Error capturado:', err));
process.on('uncaughtException', (err) => console.error('Excepción capturada:', err));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function normalizeText(text) {
  if (!text) return '';
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function fetchYouTube(query, excludedString) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { error: "Falta YOUTUBE_API_KEY en Render." };

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "15"); // Pedimos 15 para tener margen tras filtrar
    url.searchParams.set("q", query);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok) {
      return { error: `Google API (${res.status}): ${data.error?.message || 'Error'}` };
    }

    const rawItems = data.items || [];
    const excludedTerms = excludedString ? excludedString.split(/[\s,]+/).filter(Boolean) : [];

    const filtered = rawItems
      .map(item => {
        if (!item.id?.videoId || !item.snippet?.title) return null;
        return {
          title: item.snippet.title,
          channel: item.snippet.channelTitle || 'Canal',
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        };
      })
      .filter(Boolean)
      .filter(item => {
        if (excludedTerms.length === 0) return true;
        const cleanFull = normalizeText(`${item.title} ${item.channel}`);
        return !excludedTerms.some(term => {
          const cleanTerm = normalizeText(term);
          return cleanTerm && cleanFull.includes(cleanTerm);
        });
      })
      .slice(0, 5); // Máximo 5 resultados como querías

    return { results: filtered };
  } catch (err) {
    return { error: `Fallo de conexión: ${err.message}` };
  }
}

// Comando simplificado al máximo: Solo Name y Exclude
const command = new SlashCommandBuilder()
  .setName('video-search')
  .setDescription('Busca hasta 5 vídeos excluyendo palabras')
  .addStringOption(opt => 
    opt.setName('name')
      .setDescription('Término de búsqueda')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('exclude')
      .setDescription('Palabras a excluir (separadas por espacio)'));

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log('Comando registrado correctamente');
  } catch (e) {
    console.error('Error al registrar comando:', e);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'video-search') {
    // 1. Avisamos de inmediato a Discord para ganar tiempo
    await interaction.deferReply();

    try {
      const name = interaction.options.getString('name');
      const exclude = interaction.options.getString('exclude');

      const data = await fetchYouTube(name, exclude);

      const embed = new EmbedBuilder()
        .setTitle(`Búsqueda: "${name}"`)
        .setColor('#0099FF');

      if (data.error) {
        embed.addFields({ name: '🔴 YouTube', value: `⚠️ ${data.error}` });
      } else if (data.results && data.results.length > 0) {
        let text = '';
        data.results.forEach(item => {
          text += `• [${item.title}](${item.url}) — *${item.channel}*\n`;
        });
        embed.addFields({ name: '🔴 YouTube (Top 5)', value: text });
      } else {
        embed.addFields({ name: '🔴 YouTube', value: 'No se encontraron vídeos con esos criterios.' });
      }

      // 2. Respondemos con el cuadro de resultados
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en interacción:', err);
      await interaction.editReply(`Ocurrió un error inesperado: ${err.message}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
