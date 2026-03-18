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

let storeCache = {
  items: [],
  fetchedAt: 0
};

const CACHE_MS = 5 * 60 * 1000;

app.get("/", (req, res) => {
  res.send("WhatsApp fiyat botu çalışıyor.");
});

// Kendi numarana menü test etmek için
app.get("/test-menu", async (req, res) => {
  try {
    const to = "905531154341"; // kendi numaran
    await sendMainMenu(to);
    res.send("Menü gönderildi.");
  } catch (error) {
    console.error("TEST MENU HATASI:", error.response?.data || error.message);
    res.status(500).send("Menü gönderilemedi.");
  }
});

// Ürünleri görmek için test endpoint
app.get("/test-products", async (req, res) => {
  try {
    const products = await getStoreProducts();
    res.json(products);
  } catch (error) {
    console.error("TEST PRODUCTS HATASI:", error.response?.data || error.message);
    res.status(500).json({ error: "Ürünler çekilemedi." });
  }
});

// Tek ürün detayını görmek için test endpoint
app.get("/test-product-detail", async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug) {
      return res.status(400).json({ error: "slug gerekli" });
    }

    const detail = await getProductDetailBySlug(slug);
    res.json(detail);
  } catch (error) {
    console.error("TEST PRODUCT DETAIL HATASI:", error.response?.data || error.message);
    res.status(500).json({ error: "Ürün detayı çekilemedi." });
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

    // Kullanıcı düz metin yazarsa ana menü
    if (message.type === "text") {
      await sendMainMenu(from);
      return res.sendStatus(200);
    }

    // Buton veya liste seçimi
    if (message.type === "interactive") {
      const buttonReply = message.interactive?.button_reply;
      const listReply = message.interactive?.list_reply;
      const selectedId = buttonReply?.id || listReply?.id;

      console.log("INTERACTIVE SECIM:", selectedId);

      if (selectedId === "BTN_PRICE") {
        await sendCategoryMenu(from);
      } else if (selectedId === "BTN_PRODUCTS") {
        await sendCategorySummary(from);
      } else if (selectedId === "BTN_SUPPORT") {
        await sendText(
          from,
          "Destek talebinizi kısa şekilde yazın, size dönüş yapalım."
        );
      } else if (selectedId.startsWith("CAT_")) {
        const categorySlug = selectedId.replace("CAT_", "");
        await sendProductsByCategory(from, categorySlug);
      } else if (selectedId.startsWith("PROD_")) {
        const productSlug = selectedId.replace("PROD_", "");
        await sendSelectedProductDetail(from, productSlug);
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
    authHeaders()
  );
}

// Kategori özeti
async function sendCategorySummary(to) {
  const products = await getStoreProducts();

  const categories = getUniqueCategories(products);

  const text =
    "Mağazada bulunan kategoriler:\n\n" +
    categories.map((c) => `• ${c.name}`).join("\n") +
    "\n\nFiyat almak için 'Fiyat Al' seçeneğini kullanabilirsiniz.";

  await sendText(to, text);
}

// Kategori menüsü
async function sendCategoryMenu(to) {
  const products = await getStoreProducts();
  const categories = getUniqueCategories(products);

  const rows = categories.slice(0, 10).map((category) => ({
    id: `CAT_${category.slug}`,
    title: truncate(category.name, 24),
    description: `${category.count} ürün`
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
          text: "Lütfen kategori seçin."
        },
        action: {
          button: "Kategorileri Gör",
          sections: [
            {
              title: "Kategoriler",
              rows
            }
          ]
        }
      }
    },
    authHeaders()
  );
}

// Kategoriye göre sadece ürün isimlerini göster
async function sendProductsByCategory(to, categorySlug) {
  const products = await getStoreProducts();

  const filtered = products.filter((p) => p.categorySlug === categorySlug);

  if (!filtered.length) {
    await sendText(to, "Bu kategoride ürün bulunamadı.");
    return;
  }

  const categoryName = filtered[0].category || "Kategori";

  const rows = filtered.slice(0, 10).map((product) => ({
    id: `PROD_${product.slug}`,
    title: truncate(cleanProductName(product.name), 24),
    description: "Ürün detayını görmek için seçin"
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
          text: `${categoryName} kategorisindeki ürünlerden birini seçin.`
        },
        action: {
          button: "Ürünleri Gör",
          sections: [
            {
              title: truncate(categoryName, 24),
              rows
            }
          ]
        }
      }
    },
    authHeaders()
  );

  if (filtered.length > 10) {
    await sendText(
      to,
      `Bu kategoride toplam ${filtered.length} ürün var. Şu anda ilk 10 ürün gösterildi.`
    );
  }
}

// Ürün seçildikten sonra detay sayfasını okuyup cevap ver
async function sendSelectedProductDetail(to, productSlug) {
  const detail = await getProductDetailBySlug(productSlug);

  if (!detail) {
    await sendText(to, "Ürün detayı alınamadı. Lütfen tekrar deneyin.");
    return;
  }

  let text =
    `*${cleanProductName(detail.name)}*\n\n` +
    `Kategori: ${detail.category || "-"}\n`;

  if (detail.priceText) {
    text += `Fiyat: ${detail.priceText}\n`;
  }

  if (detail.shortDescription) {
    text += `\n${detail.shortDescription}\n`;
  }

  if (detail.variationSummary) {
    text += `\n*Seçenekler / KG / Varyasyonlar*\n${detail.variationSummary}\n`;
  }

  if (detail.url) {
    text += `\nÜrün linki: ${detail.url}`;
  }

  await sendText(to, text);

  if (detail.hasVariants) {
    await sendText(
      to,
      "Bu ürün varyasyonlu görünüyor. İsterseniz istediğiniz kg veya seçeneği yazın, buna göre daha net yönlendirme yapayım."
    );
  }
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
    authHeaders()
  );
}

function authHeaders() {
  return {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  };
}

// Mağaza ürünlerini liste sayfasından çek
async function getStoreProducts() {
  const now = Date.now();

  if (
    storeCache.items.length > 0 &&
    now - storeCache.fetchedAt < CACHE_MS
  ) {
    return storeCache.items;
  }

  const response = await axios.get(STORE_URL, {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const $ = cheerio.load(response.data);
  const products = [];

  $("li.product, .products .product, ul.products > li").each((_, el) => {
    const card = $(el);

    const category =
      card.find(".product-cat, .posted_in a").first().text().trim() ||
      extractCategoryFromCardText(card.text());

    const name =
      card.find(".woocommerce-loop-product__title, h2").first().text().trim() ||
      card.find("a[href*='/product/']").first().text().trim();

    const link =
      card.find("a.woocommerce-LoopProduct-link").first().attr("href") ||
      card.find("a[href*='/product/']").first().attr("href") ||
      "";

    if (!name || !link) return;

    const url = normalizeUrl(link);
    const slug = extractProductSlug(url);

    const rawText = card.text().replace(/\s+/g, " ").trim();

    const hasVariants =
      /birden fazla varyasyonu var/i.test(rawText) ||
      /Seçenekler/i.test(rawText);

    products.push({
      slug,
      name,
      cleanName: cleanProductName(name),
      category,
      categorySlug: makeSlug(category),
      hasVariants,
      url
    });
  });

  const unique = dedupeBySlug(products);

  storeCache = {
    items: unique,
    fetchedAt: now
  };

  return unique;
}

// Ürün detay sayfasını oku
async function getProductDetailBySlug(slug) {
  const products = await getStoreProducts();
  const product = products.find((p) => p.slug === slug);

  if (!product?.url) return null;

  const response = await axios.get(product.url, {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const $ = cheerio.load(response.data);

  const name =
    $(".product_title").first().text().trim() ||
    $("h1").first().text().trim() ||
    product.name;

  const category =
    $(".posted_in a").first().text().trim() ||
    product.category ||
    "";

  const priceText = $(".price").first().text().replace(/\s+/g, " ").trim();

  const shortDescription =
    $(".woocommerce-product-details__short-description").first().text().replace(/\s+/g, " ").trim() ||
    $(".product-short-description").first().text().replace(/\s+/g, " ").trim() ||
    "";

  // select / option bazlı varyasyonları yakala
  const variationOptions = [];
  $("form.variations_form select option").each((_, el) => {
    const value = $(el).attr("value") || "";
    const label = $(el).text().replace(/\s+/g, " ").trim();

    if (!label) return;
    if (label.toLowerCase().includes("bir seçenek seçin")) return;
    if (!value) return;

    variationOptions.push(label);
  });

  // buton / radio benzeri seçenekleri de yakala
  $(".variable-items-wrapper .variable-item, .variations .label, .variations td.value").each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;
    if (txt.length < 2) return;
    variationOptions.push(txt);
  });

  const cleanedVariationOptions = uniqueCleanList(
    variationOptions
      .map((v) => v.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  );

  const variationSummary = cleanedVariationOptions.length
    ? cleanedVariationOptions.map((v) => `• ${v}`).join("\n")
    : "";

  const hasVariants = product.hasVariants || cleanedVariationOptions.length > 0;

  return {
    slug,
    name,
    category,
    priceText: cleanPriceText(priceText),
    shortDescription: truncateText(shortDescription, 500),
    variationSummary,
    hasVariants,
    url: product.url
  };
}

function getUniqueCategories(products) {
  const map = new Map();

  for (const product of products) {
    const slug = product.categorySlug || "diger";
    const name = product.category || "Diğer";

    if (!map.has(slug)) {
      map.set(slug, {
        slug,
        name,
        count: 1
      });
    } else {
      map.get(slug).count += 1;
    }
  }

  return [...map.values()];
}

function extractCategoryFromCardText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();

  const knownCategories = [
    "Boyalar Zemin Sistemleri",
    "Su Yalıtım Ürünleri",
    "Yapı Kimyasalları",
    "Yardımcı Ürünler ve Astarlar"
  ];

  for (const category of knownCategories) {
    if (normalized.includes(category)) return category;
  }

  return "";
}

function cleanProductName(name) {
  return name
    .replace(/^Quattro\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPriceText(priceText) {
  return priceText.replace(/\s+/g, " ").trim();
}

function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function extractProductSlug(url) {
  const clean = url.split("?")[0].replace(/\/+$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1];
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

function uniqueCleanList(items) {
  return [...new Set(items)];
}

function truncate(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function truncateText(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
