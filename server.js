const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { makeid } = require('./gen-id');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Dossier temporaire pour sessions (non persistant)
const sessionFolder = './temp';
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

// Route pour connecter le bot
app.post('/connect', async (req, res) => {
    const number = req.body.number;
    if (!number) return res.status(400).send({ error: 'Numéro manquant' });

    const id = makeid();
    const sessionPath = `${sessionFolder}/${id}`;
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: Browsers.macOS("Safari")
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            const pairingCode = await sock.requestPairingCode(number);
            return res.send({ pairingCode });
        }

        sock.ev.on('connection.update', ({ connection }) => {
            if (connection === 'open') {
                console.log(`✅ Bot connecté pour ${number}`);

                // Répond aux commandes
                sock.ev.on('messages.upsert', async (msgUpsert) => {
                    const msg = msgUpsert.messages[0];
                    if (!msg.message || msg.key.fromMe) return;
                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                    if (!text) return;

                    if (text.toLowerCase() === '/ping') await sock.sendMessage(msg.key.remoteJid, { text: 'Pong!' });
                    if (text.toLowerCase() === '/help') await sock.sendMessage(msg.key.remoteJid, { text: '/ping\n/help\n/say [message]' });
                    if (text.toLowerCase().startsWith('/say ')) {
                        const sayText = text.slice(5);
                        await sock.sendMessage(msg.key.remoteJid, { text: sayText });
                    }
                });
            }
        });

        res.send({ message: 'Bot en cours de connexion, si première connexion un pairing code sera généré.' });

    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Impossible de connecter le bot' });
    }
});

app.listen(PORT, () => console.log(`🌐 Serveur lancé sur http://localhost:${PORT}`));
