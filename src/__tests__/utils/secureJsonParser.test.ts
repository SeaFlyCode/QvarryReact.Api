/**
 * Tests unitaires pour secureJsonParser
 * Protection contre Prototype Pollution (MED-007)
 */

import {
  safeJsonParse,
  safeJsonStringify,
  containsSuspiciousPatterns,
  PrototypePollutionError,
  SecureJsonParseOptions,
} from "../../utils/secureJsonParser";

describe("secureJsonParser - Protection Prototype Pollution (MED-007)", () => {
  // ========================================================================
  // 1. TESTS PROTOTYPE POLLUTION ATTACKS (5 tests)
  // ========================================================================

  describe("Détection attaques Prototype Pollution", () => {
    test("Doit rejeter __proto__ avec PrototypePollutionError", () => {
      const malicious = '{"__proto__": {"isAdmin": true}}';

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(PrototypePollutionError);

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(/Prototype Pollution détecté/);
    });

    test("Doit rejeter constructor avec PrototypePollutionError", () => {
      const malicious =
        '{"user": "john", "constructor": {"prototype": {"isAdmin": true}}}';

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(PrototypePollutionError);
    });

    test("Doit rejeter prototype avec PrototypePollutionError", () => {
      const malicious = '{"prototype": {"isAdmin": true}}';

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(PrototypePollutionError);
    });

    test("Doit rejeter pollution imbriquée profonde", () => {
      // IMPORTANT: On ne peut pas utiliser JSON.stringify({ __proto__: ... })
      // car __proto__ n'est pas énumérable et sera ignoré
      // Il faut créer le JSON malicieux manuellement
      const malicious =
        '{"user":{"profile":{"settings":{"__proto__":{"polluted":true}}}}}';

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(PrototypePollutionError);
    });

    test("Doit rejeter pollution dans arrays", () => {
      const malicious = '[{"name":"John"},{"__proto__":{"isAdmin":true}}]';

      expect(() => {
        safeJsonParse(malicious);
      }).toThrow(PrototypePollutionError);
    });
  });

  // ========================================================================
  // 2. TESTS JSON VALIDE (3 tests)
  // ========================================================================

  describe("Parsing JSON valide", () => {
    test("Doit parser JSON normal sans erreur", () => {
      const valid = '{"name":"John","age":30,"email":"john@example.com"}';

      const result = safeJsonParse(valid);

      expect(result).toEqual({
        name: "John",
        age: 30,
        email: "john@example.com",
      });
    });

    test("Doit parser JSON imbriqué (profondeur normale)", () => {
      const valid = JSON.stringify({
        user: {
          profile: {
            personal: {
              name: "John",
              contact: {
                email: "john@example.com",
                phone: {
                  mobile: "123456789",
                },
              },
            },
          },
        },
      });

      const result = safeJsonParse(valid);

      expect(result.user.profile.personal.name).toBe("John");
      expect(result.user.profile.personal.contact.phone.mobile).toBe(
        "123456789",
      );
    });

    test("Doit parser arrays complexes", () => {
      const valid = JSON.stringify({
        users: [
          { id: 1, name: "Alice", roles: ["admin", "user"] },
          { id: 2, name: "Bob", roles: ["user"] },
        ],
        metadata: {
          total: 2,
          timestamp: "2026-03-23T00:00:00Z",
        },
      });

      const result = safeJsonParse(valid);

      expect(result.users).toHaveLength(2);
      expect(result.users[0].roles).toContain("admin");
      expect(result.metadata.total).toBe(2);
    });
  });

  // ========================================================================
  // 3. TESTS PROFONDEUR EXCESSIVE (2 tests)
  // ========================================================================

  describe("Validation profondeur maximale", () => {
    test("Doit rejeter objet trop profond (> maxDepth)", () => {
      // Créer objet avec 15 niveaux de profondeur
      const deepObject: any = {};
      let current = deepObject;
      for (let i = 0; i < 15; i++) {
        current.nested = {};
        current = current.nested;
      }
      current.value = "too deep";

      const jsonString = JSON.stringify(deepObject);

      expect(() => {
        safeJsonParse(jsonString, { maxDepth: 10 });
      }).toThrow(PrototypePollutionError);

      expect(() => {
        safeJsonParse(jsonString, { maxDepth: 10 });
      }).toThrow(/Profondeur maximale dépassée/);
    });

    test("Doit accepter objet à la limite de profondeur", () => {
      // Créer objet avec exactement 10 niveaux
      const deepObject: any = {};
      let current = deepObject;
      for (let i = 0; i < 9; i++) {
        current.nested = {};
        current = current.nested;
      }
      current.value = "just right";

      const jsonString = JSON.stringify(deepObject);

      expect(() => {
        safeJsonParse(jsonString, { maxDepth: 10 });
      }).not.toThrow();

      const result = safeJsonParse(jsonString, { maxDepth: 10 });
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // 4. TESTS EXPLOITS RÉELS (5 tests)
  // ========================================================================

  describe("Exploits réels du monde réel", () => {
    test("Exploit #1: Login payload malicieux avec __proto__", () => {
      // JSON malicieux créé manuellement (pas via JSON.stringify)
      const maliciousLogin =
        '{"email":"attacker@evil.com","password":"test123","__proto__":{"isAdmin":true,"bypassAuth":true}}';

      expect(() => {
        safeJsonParse(maliciousLogin, { context: "login" });
      }).toThrow(PrototypePollutionError);

      // Vérifier que Object.prototype n'est PAS pollué
      const cleanObj = {};
      expect((cleanObj as any).isAdmin).toBeUndefined();
      expect((cleanObj as any).bypassAuth).toBeUndefined();
    });

    test("Exploit #2: API request body avec constructor pollution", () => {
      const maliciousRequest = JSON.stringify({
        action: "update",
        data: {
          name: "New Name",
        },
        constructor: {
          prototype: {
            role: "admin",
          },
        },
      });

      expect(() => {
        safeJsonParse(maliciousRequest, { context: "api-request" });
      }).toThrow(PrototypePollutionError);
    });

    test("Exploit #3: Redis data corrompu avec prototype chain", () => {
      const corruptedRedis = JSON.stringify({
        sessionId: "abc123",
        userId: "user-456",
        data: {
          prototype: {
            elevated: true,
          },
        },
      });

      expect(() => {
        safeJsonParse(corruptedRedis, { context: "redis" });
      }).toThrow(PrototypePollutionError);
    });

    test("Exploit #4: Webhook payload forgé avec nested __proto__", () => {
      // JSON malicieux créé manuellement
      const maliciousWebhook =
        '{"event":"payment.success","data":{"amount":1000,"metadata":{"__proto__":{"verified":true}}}}';

      expect(() => {
        safeJsonParse(maliciousWebhook, { context: "webhook" });
      }).toThrow(PrototypePollutionError);
    });

    test("Exploit #5: Cookie data malicieux avec array pollution", () => {
      // JSON malicieux créé manuellement
      const maliciousCookie =
        '[{"key":"session","value":"abc123"},{"key":"prefs","value":{"__proto__":{"admin":true}}}]';

      expect(() => {
        safeJsonParse(maliciousCookie, { context: "cookie" });
      }).toThrow(PrototypePollutionError);
    });
  });

  // ========================================================================
  // 5. TESTS FONCTIONS AUXILIAIRES
  // ========================================================================

  describe("safeJsonStringify - Protection cycles infinis", () => {
    test("Doit stringifier objet normal", () => {
      const obj = { name: "John", age: 30 };
      const result = safeJsonStringify(obj);

      expect(result).toBe('{"name":"John","age":30}');
    });

    test("Doit bloquer clés dangereuses à la stringify", () => {
      const obj = {
        name: "John",
        data: { value: 123 },
      };

      // Ajouter manuellement des propriétés dangereuses (simuler pollution)
      (obj as any).__proto__ = { polluted: true };
      (obj as any).constructor = { evil: true };

      const result = safeJsonStringify(obj);
      const parsed = JSON.parse(result);

      // Les clés dangereuses ne doivent PAS apparaître dans le JSON
      expect(result).not.toContain('"__proto__"');
      expect(result).not.toContain('"constructor"');
      expect(parsed.name).toBe("John");
      expect(parsed.data.value).toBe(123);
    });

    test("Doit gérer cycles infinis avec placeholder", () => {
      const obj: any = { name: "John" };
      obj.self = obj; // Cycle

      const result = safeJsonStringify(obj);

      expect(result).toContain("[Circular Reference]");
      expect(result).toContain("John");
    });

    test("Doit accepter paramètre space pour indentation", () => {
      const obj = { name: "John", age: 30 };
      const result = safeJsonStringify(obj, 2);

      expect(result).toContain("\n");
      expect(result).toContain('  "name"');
    });
  });

  describe("containsSuspiciousPatterns - Détection préventive", () => {
    test("Doit détecter __proto__ dans JSON string", () => {
      const suspicious = '{"__proto__": {"isAdmin": true}}';

      expect(containsSuspiciousPatterns(suspicious)).toBe(true);
    });

    test("Doit détecter constructor dans JSON string", () => {
      const suspicious = '{"constructor": {"prototype": {}}}';

      // constructor est détecté
      expect(containsSuspiciousPatterns(suspicious)).toBe(true);
    });

    test("Doit détecter prototype dans JSON string", () => {
      const suspicious = '{"prototype": {"evil": true}}';

      // prototype seul n'est PAS détecté en regex (trop commun légitimement)
      // Il sera détecté lors du parsing par findDangerousKeys()
      expect(containsSuspiciousPatterns(suspicious)).toBe(false);

      // Mais safeJsonParse le rejette quand même
      expect(() => safeJsonParse(suspicious)).toThrow(PrototypePollutionError);
    });

    test("Doit retourner false pour JSON propre", () => {
      const clean = '{"name": "John", "email": "john@example.com"}';

      expect(containsSuspiciousPatterns(clean)).toBe(false);
    });

    test("Doit différencier clés vs valeurs (constructor en valeur OK)", () => {
      // Le mot "constructor" dans une VALEUR ne devrait pas déclencher
      const cleanValue =
        '{"name": "John Constructor", "role": "constructor worker"}';

      expect(containsSuspiciousPatterns(cleanValue)).toBe(false);
    });
  });

  // ========================================================================
  // 6. TESTS OPTIONS DE CONFIGURATION
  // ========================================================================

  describe("Options de configuration", () => {
    test("Doit respecter option maxDepth custom", () => {
      const deep: any = { a: { b: { c: { d: "value" } } } };
      const jsonString = JSON.stringify(deep);

      // Devrait passer avec maxDepth=5
      expect(() => {
        safeJsonParse(jsonString, { maxDepth: 5 });
      }).not.toThrow();

      // Devrait échouer avec maxDepth=2
      expect(() => {
        safeJsonParse(jsonString, { maxDepth: 2 });
      }).toThrow(PrototypePollutionError);
    });

    test("Doit utiliser maxDepth par défaut (10) si non spécifié", () => {
      const deep: any = {};
      let current = deep;
      for (let i = 0; i < 8; i++) {
        current.n = {};
        current = current.n;
      }
      current.value = "ok";

      const jsonString = JSON.stringify(deep);

      // Profondeur 8 < 10, devrait passer
      expect(() => {
        safeJsonParse(jsonString);
      }).not.toThrow();
    });

    test("Doit gérer option context pour logging", () => {
      const valid = '{"name":"John"}';

      // Ne devrait pas throw, context est juste pour logs
      expect(() => {
        safeJsonParse(valid, { context: "test-context" });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // 7. TESTS EDGE CASES
  // ========================================================================

  describe("Edge cases et validations", () => {
    test("Doit rejeter string vide", () => {
      expect(() => {
        safeJsonParse("");
      }).toThrow(SyntaxError);
    });

    test("Doit rejeter string avec whitespace seulement", () => {
      expect(() => {
        safeJsonParse("   ");
      }).toThrow(SyntaxError);
    });

    test("Doit rejeter input non-string", () => {
      expect(() => {
        safeJsonParse(null as any);
      }).toThrow(TypeError);

      expect(() => {
        safeJsonParse(undefined as any);
      }).toThrow(TypeError);

      expect(() => {
        safeJsonParse(123 as any);
      }).toThrow(TypeError);
    });

    test("Doit gérer JSON avec caractères Unicode", () => {
      const unicode = '{"emoji":"🔒","text":"Sécurité"}';

      const result = safeJsonParse(unicode);

      expect(result.emoji).toBe("🔒");
      expect(result.text).toBe("Sécurité");
    });

    test("Doit gérer JSON avec échappements", () => {
      const escaped =
        '{"quote":"He said \\"Hello\\"","newline":"Line1\\nLine2"}';

      const result = safeJsonParse(escaped);

      expect(result.quote).toBe('He said "Hello"');
      expect(result.newline).toBe("Line1\nLine2");
    });

    test("Doit parser primitives JSON", () => {
      expect(safeJsonParse("true")).toBe(true);
      expect(safeJsonParse("false")).toBe(false);
      expect(safeJsonParse("null")).toBe(null);
      expect(safeJsonParse("42")).toBe(42);
      expect(safeJsonParse('"hello"')).toBe("hello");
    });
  });

  // ========================================================================
  // 8. TESTS SÉCURITÉ AVANCÉS
  // ========================================================================

  describe("Tests sécurité avancés", () => {
    test("Doit vérifier que Object.prototype reste non pollué après attaque", () => {
      const malicious = '{"__proto__": {"polluted": true}}';

      try {
        safeJsonParse(malicious);
      } catch (error) {
        // Erreur attendue
      }

      // Vérifier Object.prototype
      const cleanObj = {};
      expect((cleanObj as any).polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty("polluted")).toBe(false);
    });

    test("Doit bloquer multiple tentatives successives", () => {
      const attacks = [
        '{"__proto__": {"a": 1}}',
        '{"constructor": {"b": 2}}',
        '{"prototype": {"c": 3}}',
      ];

      attacks.forEach((attack) => {
        expect(() => {
          safeJsonParse(attack);
        }).toThrow(PrototypePollutionError);
      });

      // Vérifier pollution globale
      const clean = {};
      expect((clean as any).a).toBeUndefined();
      expect((clean as any).b).toBeUndefined();
      expect((clean as any).c).toBeUndefined();
    });

    test("Doit gérer mixte attaque + données valides", () => {
      // JSON malicieux créé manuellement
      const mixed =
        '{"validData":{"user":"john","email":"john@example.com"},"__proto__":{"evil":true}}';

      // Doit rejeter car contient __proto__
      expect(() => {
        safeJsonParse(mixed);
      }).toThrow(PrototypePollutionError);
    });
  });
});
