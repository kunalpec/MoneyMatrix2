import axios from "axios";

// ======== Tatum Axios Client (1) ========
export const tatumClient = axios.create({
  baseURL: "https://api.tatum.io/v3",
  headers: {
    "x-api-key": process.env.TATUM_API_KEY,
  },
  timeout: 15000,
});
