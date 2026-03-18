import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const STORE_URL = "https://magaza.yeykim.com.tr/magaza/";
const BASE_URL = "https://magaza.yeykim.com.tr";

// Bellekte kısa süreli ürün önbelleği
let productCache = {
  items: [],
  fetchedAt: 0
};

const CACHE_MS = 5 * 60 * 1000;

// Ana sayfa
app.get("/", (req, res) => {
  res.send("WhatsApp fiyat botu çalışıyor.");
});

// Test için: kendi numarana ana menü yollar
app.get("/test-menu", async (req, res) => {
  try {
    const to = "905531154341"; // KENDI NUMARANI BURAYA YAZ
    await sendMainMenu(to);
    res.send("Menü gönderildi.");
  } catch (error) {
    console.error("TEST MENU HATASI:", error.response?.data || error.message);
    res.status(500).send("Menü gönderilemedi.");
  }
});

// Test için: mağazadan ürün çekmeyi kontrol et
app.get("/test-products", async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (error) {
    console.error("TEST PRODUCTS HATASI:", error.response?.data || error.message);
    res.status(500).json({ error: "Ürünler çekilemedi." });
  }
});

// Webhook doğrulama
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WhatsApp webhook
app.post("/webhook", async (req, res) => {
  try {
    console.log("WEBHOOK POST GELDI:");
    console.log(JSON.stringify(req.body, null, 2));

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    console.log("MESAJ TYPE:", message.type);
    console.log("FROM:", from);

    if (message.type === "text") {
      await sendMainMenu(from);
      return res.sendStatus(200);
    }

    if (message.type === "interactive") {
      const buttonReply = message.interactive?.button_reply;
      const listReply = message.interactive?.list_reply;
      const selectedId = buttonReply?.id || listReply?.id;

      console.log("INTERACTIVE SECIM:", selectedId);

      if (selectedId === "BTN_PRICE") {
        await sendProductList(from);
      } else if (selectedId === "BTN_PRODUCTS") {
        await sendCategorySummary(from);
      } else if (selectedId === "BTN_SUPPORT") {
        await sendText(
          from,
          "Destek talebinizi kısa şekilde yazın, size dönüş yapalım."
        );
      } else if (selectedId?.startsWith("PROD_")) {
        const slug = selectedId.replace("PROD_", "");
        await sendProductDetail(from, slug);
      } else if (selectedId === "BTN_BACK_MAIN") {
        await sendMainMenu(from);
      } else {
        await sendText(from, "Seçiminizi aldım.");
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("WEBHOOK HATASI:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// Ana menü
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
          text: "Merhaba 👋\nSize nasıl yardımcı olalım?"
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "BTN_PRICE",
                title: "Fiyat Al"
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

// Kategori özeti
async function sendCategorySummary(to) {
  const products = await getProducts();

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  const text =
    "Mağazada bulunan kategoriler:\n\n" +
    categories.map((c) => `• ${c}`).join("\n") +
    "\n\nFiyat görmek için 'Fiyat Al' seçeneğini kullanabilirsiniz.";

  await sendText(to, text);
}

// Ürün listesini list message ile gönder
async function sendProductList(to) {
  const products = await getProducts();

  if (!products.length) {
    await sendText(to, "Şu anda ürün listesi alınamadı. Lütfen biraz sonra tekrar deneyin.");
    return;
  }

  // WhatsApp list message sınırları için ilk 10 ürünü gösterelim
  const visibleProducts = products.slice(0, 10);

  const rows = visibleProducts.map((product) => ({
    id: `PROD_${product.slug}`,
    title: truncate(product.name, 24),
    description: truncate(`${product.category} | ${product.priceText}`, 72)
  }));

  await axios.post(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "Lütfen fiyatını görmek istediğiniz ürünü seçin."
        },
        action: {
          button: "Ürünleri Gör",
          sections: [
            {
              title: "Ürün Listesi",
              rows
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

  if (products.length > 10) {
    await sendText(
      to,
      `Toplam ${products.length} ürün bulundu. Şu anda ilk 10 ürünü gösteriyorum.`
    );
  }
}

// Seçilen ürünün detayını gönder
async function sendProductDetail(to, slug) {
  const products = await getProducts();
  const product = products.find((p) => p.slug === slug);

  if (!product) {
    await sendText(to, "Ürün bulunamadı. Lütfen tekrar deneyin.");
    return;
  }

  let message =
    `*${product.name}*\n\n` +
    `Kategori: ${product.category || "-"}\n` +
    `Fiyat: ${product.priceText || "-"}`;

  if (product.hasVariants) {
    message += `\nNot: Bu ürünün birden fazla varyasyonu olabilir.`;
  }

  if (product.url) {
    message += `\nLink: ${product.url}`;
  }

  await sendText(to, message);

  // Geri dönmek için kısa yönlendirme
  await sendText(
    to,
    "Başka bir ürün görmek için tekrar mesaj yazabilir veya menüden devam edebilirsiniz."
  );
}

// Normal text mesajı
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

// Ürünleri mağaza sayfasından çek
async function getProducts() {
  const now = Date.now();

  if (
    productCache.items.length > 0 &&
    now - productCache.fetchedAt < CACHE_MS
  ) {
    return productCache.items;
  }

  const response = await axios.get(STORE_URL, {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const $ = cheerio.load(response.data);
  const products = [];

  // WooCommerce ürün kartlarını hedefle
  $("li.product, .products .product, ul.products > li").each((_, el) => {
    const card = $(el);

    let name =
      card.find("h2, .woocommerce-loop-product__title").first().text().trim() ||
      card.find("a[href*='/product/']").first().text().trim();

    const productLinkEl =
      card.find("a.woocommerce-LoopProduct-link").first().attr("href") ||
      card.find("a[href*='/product/']").first().attr("href") ||
      card.find("a").first().attr("href");

    const url = normalizeUrl(productLinkEl);

    let category =
      card.find(".posted_in a").first().text().trim() ||
      card
        .contents()
        .filter((_, node) => node.type === "text")
        .text()
        .trim();

    if (!category) {
      const rawText = card.text().replace(/\s+/g, " ").trim();
      category = inferCategory(rawText);
    }

    let priceText =
      card.find(".price").first().text().replace(/\s+/g, " ").trim() ||
      "";

    const rawText = card.text().replace(/\s+/g, " ").trim();

    const hasVariants =
      /birden fazla varyasyonu var/i.test(rawText) ||
      /Seçenekler/i.test(rawText);

    // Bazı kartlarda isim boş gelirse atla
    if (!name) return;

    // Fiyat yoksa da ürünü al ama boş bırak
    const slug = makeSlug(name);

    products.push({
      slug,
      name,
      category,
      priceText: cleanPriceText(priceText),
      hasVariants,
      url
    });
  });

  // Tekilleştir
  const uniqueProducts = dedupeBySlug(products).filter((p) => p.name);

  productCache = {
    items: uniqueProducts,
    fetchedAt: now
  };

  return uniqueProducts;
}

function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function inferCategory(text) {
  const categories = [
    "Boyalar Zemin Sistemleri",
    "Su Yalıtım Ürünleri",
    "Yapı Kimyasalları",
    "Yardımcı Ürünler ve Astarlar"
  ];

  for (const category of categories) {
    if (text.includes(category)) return category;
  }

  return "";
}

function cleanPriceText(priceText) {
  return priceText.replace(/\s+/g, " ").trim();
}

function makeSlug(text) {
  return text
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeBySlug(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.slug)) {
      map.set(item.slug, item);
    }
  }
  return [...map.values()];
}

function truncate(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});