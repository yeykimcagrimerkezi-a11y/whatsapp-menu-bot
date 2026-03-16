import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.send("WhatsApp menü botu çalışıyor.");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    if (message.type === "text") {
      await sendMainMenu(from);
      return res.sendStatus(200);
    }

    if (message.type === "interactive") {
      const buttonReply = message.interactive?.button_reply;
      const listReply = message.interactive?.list_reply;
      const selectedId = buttonReply?.id || listReply?.id;

      if (selectedId === "BTN_PRICE") {
        await sendPriceMenu(from);
      } else if (selectedId === "BTN_PRODUCTS") {
        await sendText(
          from,
          "Ürünler için temsilcimiz size yardımcı olacak. Dilerseniz ürün adını yazabilirsiniz."
        );
      } else if (selectedId === "BTN_SUPPORT") {
        await sendText(
          from,
          "Destek talebinizi kısa şekilde yazın, size dönüş yapalım."
        );
      } else if (selectedId === "PRICE_INSULATION") {
        await sendText(
          from,
          "Yalıtım kategorisini seçtiniz. Detay fiyat için temsilcimiz size ulaşacak."
        );
      } else if (selectedId === "PRICE_PAINT") {
        await sendText(
          from,
          "Boya kategorisini seçtiniz. Fiyat bilgisi için size dönüş yapılacak."
        );
      } else if (selectedId === "PRICE_PANEL") {
        await sendText(
          from,
          "Panel kategorisini seçtiniz. Size uygun ürünleri paylaşabiliriz."
        );
      } else {
        await sendText(from, "Seçiminiz alındı.");
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook hatası:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

async function sendMainMenu(to) {
  await axios.post(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "Merhaba. Size nasıl yardımcı olalım?"
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "BTN_PRICE",
                title: "Fiyat Bilgisi"
              }
            },
            {
              type: "reply",
              reply: {
                id: "BTN_PRODUCTS",
                title: "Ürünler"
              }
            },
            {
              type: "reply",
              reply: {
                id: "BTN_SUPPORT",
                title: "Destek"
              }
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function sendPriceMenu(to) {
  await axios.post(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "Lütfen fiyat almak istediğiniz kategoriyi seçin."
        },
        action: {
          button: "Kategoriler",
          sections: [
            {
              title: "Ürün Grupları",
              rows: [
                {
                  id: "PRICE_INSULATION",
                  title: "Yalıtım"
                },
                {
                  id: "PRICE_PAINT",
                  title: "Boya"
                },
                {
                  id: "PRICE_PANEL",
                  title: "Panel"
                }
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function sendText(to, text) {
  await axios.post(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: text
      }
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});