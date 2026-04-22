import express from "express";
import {
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { checkMobileAppVersion } from "../controllers/mobileAppVersionController";

const router = express.Router();

router.get("/check", verifyMobilePlatform, mobileRateLimitMiddleware, checkMobileAppVersion);

export default router;
