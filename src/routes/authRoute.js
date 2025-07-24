import { Router } from "express";
import {
  login,
  logout,
  refreshAccessToken,
  signupAdmin,
} from "../controller/authController.js";

const router = Router();

router.post("/register", signupAdmin);
router.post("/login", login);
router.post("/refresh-token", refreshAccessToken);
router.post("/logout", logout);

export default router;
