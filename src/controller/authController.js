import Prisma from "../db/db.js";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
} from "../utils/utils.js";

const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV !== "production";

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction, // Only use HTTPS in production
    sameSite: "Lax", // "Strict" blocks cookies in Postman or browser cross-origin
    path: "/",
  };

  // Access Token - 7 days
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Refresh Token - 90 days
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });

  console.log("Cookies set:", {
    accessToken,
    refreshToken,
    options: cookieOptions,
  });
};

const signupAdmin = asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body;

  if (
    [fullName, email, password].some(
      (field) => !field || field.trim().length === 0
    )
  ) {
    return ApiError.send(res, 400, "All fields are required");
  }

  const existingUser = await Prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return ApiError.send(res, 409, "Email already registered");
  }

  const hashedPassword = await hashPassword(password);

  const created = await Prisma.user.create({
    data: {
      fullName,
      email,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  if (!created) {
    return ApiError.send(res, 500, "User creation failed");
  }

  return res
    .status(201)
    .json(new ApiResponse(201, "Registered successfully", { id: created.id }));
});

const login = asyncHandler(async (req, res) => {
  let { email, password } = req.body;

  console.log("Login request received:", { email });

  if (!email || !password) {
    return ApiError.send(res, 400, "Email and password are required");
  }

  // If no domain is provided, add default domain
  if (!email.includes("@")) {
    const defaultDomain = "primewebdev.in";
    email = `${email}@${defaultDomain}`;
    console.log("Email normalized:", email);
  }

  // 1. Try logging in as admin/superadmin (User)
  const user = await Prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
      fullName: true,
    },
  });

  if (user) {
    console.log("User found:", user.email);
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      console.log("User password mismatch");
      return ApiError.send(res, 401, "Invalid credentials");
    }

    const accessToken = generateAccessToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id, user.email, user.role);
    setAuthCookies(res, accessToken, refreshToken);

    const { password: _, ...userWithoutPassword } = user;

    return res.status(200).json(
      new ApiResponse(200, "Login successful", {
        user: userWithoutPassword,
        accessTokenExpiresIn: "7d",
      })
    );
  }

  // 2. Try logging in as mailbox user
  const [localPart, domainPart] = email.split("@");
  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: localPart,
      domain: { name: domainPart },
    },
    select: {
      id: true,
      address: true,
      password: true,
      domain: {
        select: { name: true, id: true },
      },
    },
  });

  if (!mailbox) {
    console.log("Mailbox not found:", email);
    return ApiError.send(res, 404, "User or mailbox not found");
  }

  const isMatch = await comparePassword(password, mailbox.password);
  if (!isMatch) {
    console.log("Mailbox password mismatch");
    return ApiError.send(res, 401, "Invalid credentials");
  }

  const accessToken = generateAccessToken(mailbox.id, mailbox.address, "USER");
  const refreshToken = generateRefreshToken(
    mailbox.id,
    mailbox.address,
    "USER"
  );
  setAuthCookies(res, accessToken, refreshToken);

  console.log("Mailbox login successful:", mailbox.address);

  return res.status(200).json(
    new ApiResponse(200, "Mailbox login successful", {
      mailbox: {
        id: mailbox.id,
        address: mailbox.address,
        domain: mailbox.domain.name,
      },
      accessTokenExpiresIn: "7d",
    })
  );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  console.log("Cookies received:", req.cookies);

  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!refreshToken) {
    return ApiError.send(res, 401, "Refresh token missing");
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    let newAccessToken;
    if (decoded.role === "ADMIN" || decoded.role === "SUPERADMIN") {
      const user = await Prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, role: true },
      });

      if (!user) {
        return ApiError.send(res, 401, "User not found");
      }

      newAccessToken = generateAccessToken(user.id, user.email, user.role);
    } else if (decoded.role === "USER") {
      const mailbox = await Prisma.mailbox.findUnique({
        where: { id: decoded.id },
        select: { id: true, address: true },
      });

      if (!mailbox) {
        return ApiError.send(res, 401, "Mailbox not found");
      }

      newAccessToken = generateAccessToken(mailbox.id, mailbox.address, "USER");
    } else {
      return ApiError.send(res, 401, "Invalid refresh token role");
    }

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json(
      new ApiResponse(200, "Access token refreshed", {
        accessToken: newAccessToken,
        expiresIn: "7d",
      })
    );
  } catch (error) {
    return ApiError.send(res, 401, "Invalid or expired refresh token");
  }
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");

  return res.status(200).json(new ApiResponse(200, "Logged out successfully"));
});

export { signupAdmin, login, refreshAccessToken, logout };
