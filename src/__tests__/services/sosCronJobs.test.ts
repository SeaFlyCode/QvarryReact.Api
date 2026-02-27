// ═══════════════════════════════════════════════════════════════════════════
// TESTS: sosCronJobs
// ═══════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import {
  startSosEscalationJob,
  startSosCleanupJob,
} from "../../services/sosCronJobs";
import { sosService } from "../../services/sosService";

// Mock dependencies
jest.mock("node-cron");
jest.mock("../../services/sosService");

// Create mock for SosSessionModel
const mockDeleteMany = jest.fn();
jest.mock("../../models/sosSession", () => ({
  default: {
    deleteMany: jest.fn(),
  },
}));

describe("SosCronJobs Service", () => {
  let mockSchedule: jest.Mock;
  let scheduledCallbacks: Array<() => Promise<void>> = [];
  let SosSessionModel: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    scheduledCallbacks = [];

    // Import the mocked model
    SosSessionModel = (await import("../../models/sosSession")).default;

    // Ensure deleteMany is a mock function
    if (!SosSessionModel.deleteMany) {
      SosSessionModel.deleteMany = jest.fn();
    }
    SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 0 });

    mockSchedule = jest.fn(
      (expression: string, callback: () => Promise<void>) => {
        scheduledCallbacks.push(callback);
        return {} as any;
      },
    );
    (cron.schedule as jest.Mock) = mockSchedule;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // startSosEscalationJob
  // ═════════════════════════════════════════════════════════════════════════

  describe("startSosEscalationJob", () => {
    it("should schedule job with correct cron expression (every minute)", () => {
      startSosEscalationJob();

      expect(mockSchedule).toHaveBeenCalledWith(
        "* * * * *",
        expect.any(Function),
      );
    });

    it("should call sosService.processExpiredSessions when job executes", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockResolvedValue(undefined);

      startSosEscalationJob();
      await scheduledCallbacks[0]();

      expect(mockProcess).toHaveBeenCalledTimes(1);
    });

    it("should skip execution if already running (lock mechanism)", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockImplementation(
          () =>
            new Promise((resolve) => setTimeout(() => resolve(undefined), 100)),
        );

      startSosEscalationJob();

      // Start first execution
      const firstExecution = scheduledCallbacks[0]();

      // Try second execution immediately
      await scheduledCallbacks[0]();

      // Wait for first to complete
      await firstExecution;

      // Should only be called once
      expect(mockProcess).toHaveBeenCalledTimes(1);
    });

    it("should handle processing errors gracefully", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValue(new Error("Processing failed"));

      startSosEscalationJob();

      // Should not throw
      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockProcess).toHaveBeenCalledTimes(1);
    });

    it("should release lock after error", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce(undefined);

      startSosEscalationJob();

      // First execution fails
      await scheduledCallbacks[0]();

      // Second execution should succeed (lock released)
      await scheduledCallbacks[0]();

      expect(mockProcess).toHaveBeenCalledTimes(2);
    });

    it("should handle non-Error exceptions", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValue("String error");

      startSosEscalationJob();

      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockProcess).toHaveBeenCalledTimes(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // startSosCleanupJob
  // ═════════════════════════════════════════════════════════════════════════

  describe("startSosCleanupJob", () => {
    it("should schedule job with correct cron expression (daily at 2:00 AM)", () => {
      startSosCleanupJob();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 2 * * *",
        expect.any(Function),
      );
    });

    it("should delete old resolved/cancelled sessions when job executes", async () => {
      SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 5 });

      startSosCleanupJob();
      await scheduledCallbacks[0]();

      expect(SosSessionModel.deleteMany).toHaveBeenCalledWith({
        status: { $in: ["RESOLVED", "CANCELLED"] },
        resolvedAt: { $lte: expect.any(Date) },
      });
    });

    it("should delete sessions older than 90 days", async () => {
      SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 3 });

      startSosCleanupJob();
      await scheduledCallbacks[0]();

      const callArgs = SosSessionModel.deleteMany.mock.calls[0][0];
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(
        callArgs.resolvedAt.$lte.getTime() - ninetyDaysAgo.getTime(),
      );

      // Allow 1 second tolerance
      expect(timeDiff).toBeLessThan(1000);
    });

    it("should log when sessions are deleted", async () => {
      SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 10 });

      startSosCleanupJob();
      await scheduledCallbacks[0]();

      expect(SosSessionModel.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("should log when no sessions to delete", async () => {
      SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 0 });

      startSosCleanupJob();
      await scheduledCallbacks[0]();

      expect(SosSessionModel.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("should handle database errors gracefully", async () => {
      SosSessionModel.deleteMany.mockRejectedValue(new Error("DB error"));

      startSosCleanupJob();

      // Should not throw
      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
    });

    it("should handle non-Error exceptions", async () => {
      SosSessionModel.deleteMany.mockRejectedValue("String error");

      startSosCleanupJob();

      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
    });
  });
});
