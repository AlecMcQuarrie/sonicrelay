import { Router, Request, Response } from "express";
import { loadServerConfig } from "../config";

const router = Router();

router.get("/server-info", (_req: Request, res: Response) => {
  const { serverId, serverName } = loadServerConfig();
  return res.status(200).json({ serverId, serverName });
});

export default router;
