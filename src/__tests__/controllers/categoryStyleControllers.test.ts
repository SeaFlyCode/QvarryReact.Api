/**
 * Tests unitaires pour categoryStyleControllers.
 * Couvre : list, upsert (création/maj), delete, validation de :type invalide.
 */

jest.mock("../../services/categoryStyleService");

import { Request, Response } from "express";
import {
  listCategoryStyles,
  upsertCategoryStyle,
  deleteCategoryStyle,
} from "../../controllers/categoryStyleControllers";
import * as categoryStyleService from "../../services/categoryStyleService";
import { mockRequest, mockResponse } from "../mocks";

describe("categoryStyleControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();
    jest.clearAllMocks();
    // toDTO réel (le mock auto le remplace par jest.fn) → on le restaure.
    (categoryStyleService.toDTO as jest.Mock).mockImplementation(
      (doc: any) => ({
        type: doc.type,
        color: doc.color,
        icon: doc.icon,
      }),
    );
  });

  describe("listCategoryStyles", () => {
    it("renvoie 401 sans authentification", async () => {
      await listCategoryStyles(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("renvoie 200 avec la liste des styles", async () => {
      req.user = { id: "user123" };
      const styles = [{ type: "Mine", color: "#fff", icon: "i" }];
      (categoryStyleService.listStyles as jest.Mock).mockResolvedValue(styles);

      await listCategoryStyles(req as Request, res as Response);

      expect(categoryStyleService.listStyles).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(styles);
    });
  });

  describe("upsertCategoryStyle", () => {
    it("renvoie 401 sans authentification", async () => {
      req.params = { type: "Mine" };
      req.body = { color: "#22c55e", icon: "icon" };
      await upsertCategoryStyle(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("renvoie 400 si le type est invalide", async () => {
      req.user = { id: "user123" };
      req.params = { type: "Inexistant" };
      req.body = { color: "#22c55e", icon: "icon" };

      await upsertCategoryStyle(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(categoryStyleService.upsertStyle).not.toHaveBeenCalled();
    });

    it("renvoie 400 si la couleur est invalide", async () => {
      req.user = { id: "user123" };
      req.params = { type: "Mine" };
      req.body = { color: "not-a-color", icon: "icon" };

      await upsertCategoryStyle(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(categoryStyleService.upsertStyle).not.toHaveBeenCalled();
    });

    it("upsert et renvoie 200 avec le DTO", async () => {
      req.user = { id: "user123" };
      req.params = { type: "Carrière" };
      req.body = { color: "#22c55e", icon: "pickaxe" };

      const doc = { type: "Carrière", color: "#22c55e", icon: "pickaxe" };
      (categoryStyleService.upsertStyle as jest.Mock).mockResolvedValue(doc);

      await upsertCategoryStyle(req as Request, res as Response);

      expect(categoryStyleService.upsertStyle).toHaveBeenCalledWith(
        "user123",
        "Carrière",
        { color: "#22c55e", icon: "pickaxe" },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        type: "Carrière",
        color: "#22c55e",
        icon: "pickaxe",
      });
    });
  });

  describe("deleteCategoryStyle", () => {
    it("renvoie 400 si le type est invalide", async () => {
      req.user = { id: "user123" };
      req.params = { type: "Nope" };

      await deleteCategoryStyle(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(categoryStyleService.deleteStyle).not.toHaveBeenCalled();
    });

    it("supprime le style et renvoie 204", async () => {
      req.user = { id: "user123" };
      req.params = { type: "Grotte" };
      (categoryStyleService.deleteStyle as jest.Mock).mockResolvedValue({
        type: "Grotte",
      });

      await deleteCategoryStyle(req as Request, res as Response);

      expect(categoryStyleService.deleteStyle).toHaveBeenCalledWith(
        "user123",
        "Grotte",
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
