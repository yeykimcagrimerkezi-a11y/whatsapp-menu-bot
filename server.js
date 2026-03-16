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

// Ana sayfa kontrolü
app.get("/", (req, res) => {
  res.send("WhatsApp menü botu çalışıyor.");
});

// Geçici test adresi:
// Burayı tarayıcıda açınca direkt senin numarana menü göndermeyi dener
app.get("/test-menu", async (req, res) => {
  try {
    const to = "905XXXXXXXXX"; // KENDI NUMARANI YAZ. Örnek: 905356390796
    await sendMainMenu(to);
    res.send("Menü gönderildi.");
  } catch (error) {
    console.error("TEST MENU HATASI:", error.response?.data || error.message);
    res.status(500).send("Menü gönderilemedi.");
  }
});

// Meta webhook doğrulama
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("WEBHOOK GET GELDI");
  console.log("mode:", mode);
  console.log("token:", token ? "var" : "yok");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK DOGRULANDI");
    return res.status(200).send(challenge);
  }

  console.log("WEBHOOK DOGRULAMA BASARISIZ");
  return res.sendStatus(403);
});

// Meta'dan gelen mesajlar
app.post("/webhook", async (req, res) => {
  try {
    console.log("WEBHOOK POST GELDI:");
    console.log(JSON.stringify(req.body, null, 2));

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log("message yok. Muhtemelen status veya baska bir olay geldi.");
      return res.sendStatus(200);
    }

    const from = message.from;
    console.log("MESAJ TYPE:", message.type);
    console.log("FROM:", from);

    // Kullanıcı düz mesaj yazdıysa ana menüyü gönder
    if (message.type === "text") {
      console.log("TEXT mesaj algılandı, ana menü gönderiliyor...");
      await sendMainMenu(from);
      return res.sendStatus(200);
    }

    // Kullanıcı buton veya liste seçtiyse
    if (message.type === "interactive") {
      const buttonReply = message.interactive?.button_reply;
      const listReply = message.interactive?.list_reply;
      const selectedId = buttonReply?.id || listReply?.id;

      console.log("INTERACTIVE SECIM:", selectedId);

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

    console.log("Desteklenmeyen mesaj tipi:", message.type);
    return res.sendStatus(200);
  } catch (error) {
    console.error("WEBHOOK HATASI:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// 3 butonlu ana menü
async function sendMainMenu(to) {
  console.log("ANA MENU GONDERILIYOR:", to);

  const response = await axios.post(
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

  console.log("ANA MENU GONDERIM BASARILI:", response.data);
}

// Fiyat alt menüsü
async function sendPriceMenu(to) {
  console.log("FIYAT MENUSU GONDERILIYOR:", to);

  const response = await axios.post(
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

  console.log("FIYAT MENUSU GONDERIM BASARILI:", response.data);
}

// Normal yazı mesajı
async function sendText(to, text) {
  console.log("TEXT GONDERILIYOR:", to, text);

  const response = await axios.post(
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

  console.log("TEXT GONDERIM BASARILI:", response.data);
}

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});