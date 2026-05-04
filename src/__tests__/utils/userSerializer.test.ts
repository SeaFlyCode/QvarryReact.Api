import { encrypt } from "../../utils/masterEncryptionUtils";
import {
  serializeUserForApi,
  serializeUsersForApi,
} from "../../utils/userSerializer";

describe("userSerializer", () => {
  describe("serializeUserForApi", () => {
    it("retourne un objet vide quand l'entrée est null/undefined", () => {
      expect(serializeUserForApi(null)).toEqual({ _id: "", name: "" });
      expect(serializeUserForApi(undefined)).toEqual({ _id: "", name: "" });
    });

    it("déchiffre name, surname, email et pseudo", () => {
      const user = {
        _id: "u1",
        name: encrypt("Alice"),
        surname: encrypt("Martin"),
        email: encrypt("alice@example.com"),
        pseudo: encrypt("ali"),
      };

      const result = serializeUserForApi(user);

      expect(result.name).toBe("Alice");
      expect(result.surname).toBe("Martin");
      expect(result.email).toBe("alice@example.com");
      expect(result.pseudo).toBe("ali");
    });

    it("supprime les champs sensibles (password, tokens, secrets)", () => {
      const user = {
        _id: "u2",
        name: encrypt("Bob"),
        password: "hashed-password",
        password_history: ["old1", "old2"],
        reset_password_token: "tok",
        email_verification_token: "ev",
        email_verification_code: "12345",
        two_factor_secret: "secret",
        two_factor_recovery_codes: ["a", "b"],
        emailHash: "internal-hash",
      };

      const result = serializeUserForApi(user);

      expect(result.password).toBeUndefined();
      expect(result.password_history).toBeUndefined();
      expect(result.reset_password_token).toBeUndefined();
      expect(result.email_verification_token).toBeUndefined();
      expect(result.email_verification_code).toBeUndefined();
      expect(result.two_factor_secret).toBeUndefined();
      expect(result.two_factor_recovery_codes).toBeUndefined();
      expect(result.emailHash).toBeUndefined();
    });

    it("est idempotent : tolère un user déjà déchiffré (rétrocompat)", () => {
      const alreadyDecrypted = {
        _id: "u3",
        name: "Charlie",
        surname: "Doe",
        email: "charlie@example.com",
      };

      const result = serializeUserForApi(alreadyDecrypted);

      expect(result.name).toBe("Charlie");
      expect(result.surname).toBe("Doe");
      expect(result.email).toBe("charlie@example.com");
    });

    it("normalise _id en string", () => {
      const user = {
        _id: { toString: () => "507f1f77bcf86cd799439011" },
        name: encrypt("Dana"),
      };

      const result = serializeUserForApi(user);

      expect(result._id).toBe("507f1f77bcf86cd799439011");
      expect(result.name).toBe("Dana");
    });

    it("normalise name à chaîne vide si absent (contrat ApiUser)", () => {
      const user = { _id: "u4" };
      const result = serializeUserForApi(user);
      expect(result.name).toBe("");
    });

    it("supporte un document Mongoose via toObject()", () => {
      const fakeDoc = {
        toObject: () => ({
          _id: "u5",
          name: encrypt("Eve"),
          surname: encrypt("Hill"),
        }),
      };

      const result = serializeUserForApi(fakeDoc);
      expect(result.name).toBe("Eve");
      expect(result.surname).toBe("Hill");
    });

    it("ne crashe pas sur une valeur de chiffrement corrompue (retourne valeur brute)", () => {
      const user = {
        _id: "u6",
        // Format en 3 segments mais authTag invalide → decrypt throw
        name: "deadbeef:cafebabe:1234",
      };

      const result = serializeUserForApi(user);
      // Le serializer ne doit pas throw, il retourne la valeur brute en fallback.
      expect(result.name).toBe("deadbeef:cafebabe:1234");
    });
  });

  describe("serializeUsersForApi", () => {
    it("mappe une liste d'utilisateurs", () => {
      const users = [
        { _id: "1", name: encrypt("A") },
        { _id: "2", name: encrypt("B") },
      ];

      const result = serializeUsersForApi(users);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("A");
      expect(result[1].name).toBe("B");
    });
  });
});
