import type { RequestHandler, Response } from "express";
import { config } from "../config.js";
import type { AuthUser } from "./tokens.js";
import * as authService from "./auth.service.js";

const COOKIE_NAME = "refresh_token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const COOKIE_PATH = "/v1/auth";
const COOKIE_SECURE = config.NODE_ENV === "production";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
  });
}

export const signup: RequestHandler = async (req, res) => {
  const result = await authService.signup(req.body);
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({ accessToken: result.accessToken, user: result.user });
};

export const login: RequestHandler = async (req, res) => {
  const result = await authService.login(req.body);
  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken, user: result.user });
};

export const refresh: RequestHandler = async (req, res) => {
  const result = await authService.refresh(req.cookies?.[COOKIE_NAME]);
  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken });
};

export const me: RequestHandler = async (_req, res) => {
  res.json(await authService.getMe(res.locals.user as AuthUser));
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(req.cookies?.[COOKIE_NAME]);
  clearRefreshCookie(res);
  res.status(204).end();
};
