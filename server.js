// The Open Kitchen — tiny backend
// Serves the static site AND proxies chat requests to Anthropic's Claude API.
// Your API key lives only here (as an environment variable), never in the browser.

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname)); // serves index.html and any other files

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest";

app.post("/api/chat", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "The server has no ANTHROPIC_API_KEY set. Add it in Render → your service → Environment."
      });
    }

    const { recipe, messages } = req.body || {};
    if (!recipe || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "A recipe and at least one message are required." });
    }

    // Build a compact text version of the recipe for the model to reason about.
    const ctx = [
      `Name: ${recipe.name}`,
      `Cuisine: ${recipe.cuisine} | Meal: ${recipe.meal} | Time: ${recipe.time} min | Difficulty: ${recipe.difficulty} | Serves: ${recipe.serves}`,
      `Dietary tags: ${recipe.diet && recipe.diet.length ? recipe.diet.join(", ") : "none"}`,
      "",
      "Ingredients:",
      ...(recipe.ingredients || []).map(i => `- ${i}`),
      "",
      "Method:",
      ...(recipe.steps || []).map((s, i) => `${i + 1}. ${s}`)
    ].join("\n");

    const system =
      "You are a warm, concise cooking assistant embedded in a recipe website. " +
      "Answer questions ONLY about the recipe below: ingredient substitutions, making it dairy-free / vegan / " +
      "gluten-free, scaling servings up or down, techniques, timings, storage, and what to serve alongside. " +
      "Keep replies short and practical — usually 1–4 sentences or a short list. Be encouraging. " +
      "If asked something unrelated to this recipe or to cooking, gently steer back. Never give unsafe food advice.\n\n" +
      "=== RECIPE ===\n" + ctx;

    // Keep only clean user/assistant turns, cap length and history.
    const safeMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
      .slice(-12);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: safeMessages })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Anthropic API error:", r.status, detail);
      return res.status(502).json({
        error: "The AI service returned an error. Check that your API key is valid and billing is set up."
      });
    }

    const data = await r.json();
    const reply =
      data.content && data.content[0] && data.content[0].text
        ? data.content[0].text.trim()
        : "Sorry, I couldn't come up with an answer for that one.";
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Something went wrong talking to the AI." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`The Open Kitchen is running on port ${PORT}`));
