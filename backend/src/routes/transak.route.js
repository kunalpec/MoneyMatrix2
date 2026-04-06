import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/token", async (req, res) => {
  try {
    const response = await axios.post(
      "https://api-stg.transak.com/partners/api/v2/refresh-token",
      {
        apiKey: process.env.TRANSAK_API_KEY,
      },
      {
        headers: {
          "api-secret": process.env.TRANSAK_API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to fetch Transak token",
    });
  }
});

export default router;