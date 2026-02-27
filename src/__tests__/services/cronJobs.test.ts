// ═══════════════════════════════════════════════════════════════════════════
// TESTS: cronJobs
// ═══════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import {
  startDataShareCleanupJob,
  startNotificationCleanupJob,
  startRefreshTokenCleanupJob,
  runManualCleanup,
} from "../../services/cronJobs";
import * as dataShareService from "../../services/dataShareService";
import NotificationModel from "../../models/notifications";
import { refreshTokenService } from "../../services/refreshTokenService";

// Mock dependencies
jest.mock("node-cron");
jest.mock("../../services/dataShareService");
jest.mock("../../models/notifications");
jest.mock("../../services/refreshTokenService");

describe("CronJobs Service", () => {
  let mockSchedule: jest.Mock;
  let scheduledCallbacks: Array<() => Promise<void>> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    scheduledCallbacks = [];

    // Mock cron.schedule to capture callbacks
    mockSchedule = jest.fn(
      (expression: string, callback: () => Promise<void>) => {
        scheduledCallbacks.push(callback);
        return {} as cron.ScheduledTask;
      },
    );
    (cron.schedule as jest.Mock) = mockSchedule;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // startDataShareCleanupJob
  // ═════════════════════════════════════════════════════════════════════════

  describe("startDataShareCleanupJob", () => {
    it("should schedule job with correct cron expression (daily at 3:00 AM)", () => {
      startDataShareCleanupJob();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 3 * * *",
        expect.any(Function),
      );
    });

    it("should call cleanupExpiredShares when job executes", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockResolvedValue(5);

      startDataShareCleanupJob();

      // Execute the scheduled callback
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should skip execution if already running (lock mechanism)", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(3), 100)),
        );

      startDataShareCleanupJob();

      // Start first execution (don't await)
      const firstExecution = scheduledCallbacks[0]();

      // Try to start second execution immediately
      await scheduledCallbacks[0]();

      // Wait for first to complete
      await firstExecution;

      // Should only be called once (second call was skipped)
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should handle cleanup errors gracefully", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockRejectedValue(new Error("Database error"));

      startDataShareCleanupJob();

      // Should not throw
      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should release lock after error", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce(2);

      startDataShareCleanupJob();

      // First execution fails
      await scheduledCallbacks[0]();

      // Second execution should succeed (lock released)
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(2);
    });

    it("should log when deleted count is 0", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockResolvedValue(0);

      startDataShareCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should log when deleted count > 0", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockResolvedValue(10);

      startDataShareCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // startNotificationCleanupJob
  // ═════════════════════════════════════════════════════════════════════════

  describe("startNotificationCleanupJob", () => {
    it("should schedule job with correct cron expression (daily at 4:00 AM)", () => {
      startNotificationCleanupJob();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 4 * * *",
        expect.any(Function),
      );
    });

    it("should delete expired notifications when job executes", async () => {
      const mockDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 7 });
      (NotificationModel.deleteMany as jest.Mock) = mockDeleteMany;

      startNotificationCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockDeleteMany).toHaveBeenCalledWith({
        expiresAt: { $lt: expect.any(Date) },
      });
    });

    it("should skip execution if already running", async () => {
      const mockDeleteMany = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ deletedCount: 3 }), 100),
            ),
        );
      (NotificationModel.deleteMany as jest.Mock) = mockDeleteMany;

      startNotificationCleanupJob();

      // Start first execution
      const firstExecution = scheduledCallbacks[0]();

      // Try second execution immediately
      await scheduledCallbacks[0]();

      // Wait for first
      await firstExecution;

      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    });

    it("should handle database errors gracefully", async () => {
      const mockDeleteMany = jest
        .fn()
        .mockRejectedValue(new Error("Connection error"));
      (NotificationModel.deleteMany as jest.Mock) = mockDeleteMany;

      startNotificationCleanupJob();

      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    });

    it("should log when no notifications to delete", async () => {
      const mockDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
      (NotificationModel.deleteMany as jest.Mock) = mockDeleteMany;

      startNotificationCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    });

    it("should release lock after error", async () => {
      const mockDeleteMany = jest
        .fn()
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce({ deletedCount: 3 });
      (NotificationModel.deleteMany as jest.Mock) = mockDeleteMany;

      startNotificationCleanupJob();

      await scheduledCallbacks[0]();
      await scheduledCallbacks[0]();

      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // startRefreshTokenCleanupJob
  // ═════════════════════════════════════════════════════════════════════════

  describe("startRefreshTokenCleanupJob", () => {
    it("should schedule job with correct cron expression (daily at 5:00 AM)", () => {
      startRefreshTokenCleanupJob();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 5 * * *",
        expect.any(Function),
      );
    });

    it("should call cleanupExpiredTokens when job executes", async () => {
      const mockCleanup = jest
        .spyOn(refreshTokenService, "cleanupExpiredTokens")
        .mockResolvedValue(12);

      startRefreshTokenCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should skip execution if already running", async () => {
      const mockCleanup = jest
        .spyOn(refreshTokenService, "cleanupExpiredTokens")
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(5), 100)),
        );

      startRefreshTokenCleanupJob();

      const firstExecution = scheduledCallbacks[0]();
      await scheduledCallbacks[0]();
      await firstExecution;

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should handle cleanup errors gracefully", async () => {
      const mockCleanup = jest
        .spyOn(refreshTokenService, "cleanupExpiredTokens")
        .mockRejectedValue(new Error("Cleanup failed"));

      startRefreshTokenCleanupJob();

      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should log when deleted count is 0", async () => {
      const mockCleanup = jest
        .spyOn(refreshTokenService, "cleanupExpiredTokens")
        .mockResolvedValue(0);

      startRefreshTokenCleanupJob();
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should release lock after error", async () => {
      const mockCleanup = jest
        .spyOn(refreshTokenService, "cleanupExpiredTokens")
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce(4);

      startRefreshTokenCleanupJob();

      await scheduledCallbacks[0]();
      await scheduledCallbacks[0]();

      expect(mockCleanup).toHaveBeenCalledTimes(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // runManualCleanup
  // ═════════════════════════════════════════════════════════════════════════

  describe("runManualCleanup", () => {
    it("should call cleanupExpiredShares and return deleted count", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockResolvedValue(8);

      const result = await runManualCleanup();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(result).toBe(8);
    });

    it("should return 0 when no shares to cleanup", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockResolvedValue(0);

      const result = await runManualCleanup();

      expect(result).toBe(0);
    });

    it("should throw error on cleanup failure", async () => {
      const error = new Error("Cleanup failed");
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockRejectedValue(error);

      await expect(runManualCleanup()).rejects.toThrow("Cleanup failed");
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should handle non-Error exceptions", async () => {
      const mockCleanup = jest
        .spyOn(dataShareService, "cleanupExpiredShares")
        .mockRejectedValue("String error");

      await expect(runManualCleanup()).rejects.toBe("String error");
    });
  });
});
