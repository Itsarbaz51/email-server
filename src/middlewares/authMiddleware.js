import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler.js";
import Prisma from "../db/db.js";
import { ApiError } from "../utils/ApiError.js";
import { comparePassword } from "../utils/utils.js";

const authMiddleware = asyncHandler(async (req, res, next) => {
  console.log(req.body);
  
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return ApiError.send(res, 401, "Authorization token missing");
    }
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, {
      ignoreExpiration: false,
    });

    // Check for role: user or mailbox
    if (decoded.role === "ADMIN" || decoded.role === "SUPERADMIN") {
      const user = await Prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          email: true,
          role: true,
          fullName: true,
          domains: true,
        },
      });

      if (!user) {
        return ApiError.send(res, 401, "Invalid token - user not found");
      }

      req.user = user;
    } else if (decoded.role === "USER") {
      const mailbox = await Prisma.mailbox.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          address: true,
          domainId: true,
        },
      });

      if (!mailbox) {
        return ApiError.send(res, 401, "Invalid token - mailbox not found");
      }

      req.mailbox = mailbox;
    } else {
      return ApiError.send(res, 401, "Invalid token role");
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return ApiError.send(res, 401, "Token expired");
    }
    if (error.name === "JsonWebTokenError") {
      return ApiError.send(res, 401, "Invalid token");
    }
    return ApiError.send(
      res,
      401,
      error?.message + " authMiddleware" || "Authentication failed"
    );
  }
});

export { authMiddleware };
