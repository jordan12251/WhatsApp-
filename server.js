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

// Créer automatiquement les dossiers si ils n'existent pas
const sessionFolder = './sessions';
const tempFolder = './temp';
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

// Route pour connecter le bot
app.post('/connect', async (req, res) => {
    const number = req.body.number;
    if (!number) return res.status(400).send({ error: 'Numéro manquant' });

    const id = makeid();
    const tempSessionPath = `${tempFolder}/${id}`;
    const sessionPath = `${sessionFolder}/${id}`;
    if (!fs.existsSync(tempSessionPath)) fs.mkdirSync(tempSessionPath, { recursive: true });

    try {
        // Crée la session temporaire
        const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);

        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: Browsers.macOS("Safari")
        });

        sock.ev.on('creds.update', saveCreds);

        // Si le bot n'est pas encore enregistré, demander le pairing code
        if (!sock.authState.creds.registered) {
            const pairingCode = await sock.requestPairingCode(number);
            return res.send({ pairingCode });
        }

        // Quand le bot est connecté
        sock.ev.on('connection.update', async ({ connection }) => {
            if (connection === 'open') {
                console.log(`✅ Bot connecté pour ${number}`);

                // Déplacer la session de temp/ vers sessions/ pour persistance
                if (fs.existsSync(tempSessionPath)) {
                    fs.cpSync(tempSessionPath, sessionPath, { recursive: true });
                    fs.rmSync(tempSessionPath, { recursive: true, force: true });
                    console.log(`💾 Session sauvegardée dans sessions/${id}`);
                }

                // Répond aux commandes
                sock.ev.on('messages.upsert', async (msgUpsert) => {
                    const msg = msgUpsert.messages[0];
                    if (!msg.message || msg.key.fromMe) return;
                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                    if (!text) return;

                    const lowerText = text.toLowerCase();
                    if (lowerText === '/ping') await sock.sendMessage(msg.key.remoteJid, { text: 'Pong!' });
                    if (lowerText === '/help') await sock.sendMessage(msg.key.remoteJid, { text: '/ping\n/help\n/say [message]' });
                    if (lowerText.startsWith('/say ')) {
                        const sayText = text.slice(5);
                        await sock.sendMessage(msg.key.remoteJid, { text: sayText });
                    }
                });
            }
        });

        res.send({ message: 'Bot en cours de connexion. Si première connexion, un pairing code sera généré.' });

    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Impossible de connecter le bot' });
    }
});

// Lancer le serveur
app.listen(PORT, () => console.log(`🌐 Serveur lancé sur http://localhost:${PORT}`));
