
const { GoogleGenerativeAI } = require("@google/generative-ai");

export const genAI = new GoogleGenerativeAI({
  apiKey:process.env.GEMINI_API_KEY
});