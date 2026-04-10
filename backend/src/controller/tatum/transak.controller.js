import axios from "axios";
import { ApiError } from "../../util/ApiError.util.js";

const getTransakRefreshTokenUrl = () => {
  const isDev = process.env.NODE_ENV === "development";

  return isDev
    ? "https://api-stg.transak.com/partners/api/v2/refresh-token"
    : "https://api.transak.com/partners/api/v2/refresh-token";
};

const generateTransakAccessToken = async () => {
  if (!process.env.TRANSAK_API_KEY || !process.env.TRANSAK_API_SECRET) {
    throw new ApiError(500, "TRANSAK_API_KEY or TRANSAK_API_SECRET is missing in backend/.env");
  }

  try {
    const response = await axios.post(
      getTransakRefreshTokenUrl(),
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

    return response.data?.data || {};
  } catch (error) {
    throw new ApiError(
      error?.response?.status || 500,
      error?.response?.data?.message || "Failed to fetch Transak token"
    );
  }
};

const getTransakAccessToken = async (req, res) => {
  const data = await generateTransakAccessToken();
  return res.json(data);
};

export { generateTransakAccessToken, getTransakAccessToken };
