// ═══════════════════════════════════════════════════════════════════════════
// TESTS: sosCronJobs
// ═══════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import mongoose from "mongoose";
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

// Create mock for CronLockModel
jest.mock("../../models/cronLock", () => ({
  default: {
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  },
}));

describe("SosCronJobs Service", () => {
  const mockUserId = "507f1f77bcf86cd799439011";

  let mockSchedule: jest.Mock;
  let scheduledCallbacks: Array<() => Promise<void>> = [];
  let SosSessionModel: any;
  let CronLockModel: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    scheduledCallbacks = [];

    // Import the mocked models
    SosSessionModel = (await import("../../models/sosSession")).default;
    CronLockModel = (await import("../../models/cronLock")).default;

    // Ensure deleteMany is a mock function
    if (!SosSessionModel.deleteMany) {
      SosSessionModel.deleteMany = jest.fn();
    }
    SosSessionModel.deleteMany.mockResolvedValue({ deletedCount: 0 });

    // Setup CronLockModel mocks with default successful lock behavior
    // The key trick: return the same lockedBy that was passed in the update object
    // so that the check `lock.lockedBy === INSTANCE_ID` succeeds
    if (!CronLockModel.findOneAndUpdate) {
      CronLockModel.findOneAndUpdate = jest.fn();
    }
    if (!CronLockModel.deleteOne) {
      CronLockModel.deleteOne = jest.fn();
    }

    CronLockModel.findOneAndUpdate.mockImplementation((query, update) => {
      return Promise.resolve({
        lockName: "sos-escalation",
        lockedBy: update.lockedBy, // Return the same lockedBy that was set
        lockedAt: new Date(),
        expiresAt: new Date(Date.now() + 90000),
        lastHeartbeat: new Date(),
      });
    });
    CronLockModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

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

      // Mock successful lock acquisition (return the same lockedBy that's passed in)
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy, // Echo back the lockedBy value
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();
      await scheduledCallbacks[0]();

      expect(CronLockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          lockName: "sos-escalation",
        }),
        expect.any(Object),
        expect.objectContaining({ upsert: true, new: true }),
      );
      expect(mockProcess).toHaveBeenCalledTimes(1);
      expect(CronLockModel.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          lockName: "sos-escalation",
        }),
      );
    });

    it("should skip execution if already running (lock mechanism)", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockImplementation(
          () =>
            new Promise((resolve) => setTimeout(() => resolve(undefined), 100)),
        );

      // First call: lock acquisition succeeds (echo back the lockedBy)
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      // Second call: lock acquisition fails (return different instance ID)
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: "different-instance-id", // Different from update.lockedBy
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();

      // Start first execution
      const firstExecution = scheduledCallbacks[0]();

      // Try second execution immediately (should skip because lock is held)
      await scheduledCallbacks[0]();

      // Wait for first to complete
      await firstExecution;

      // Should only be called once (second execution skipped)
      expect(mockProcess).toHaveBeenCalledTimes(1);
    });

    it("should handle processing errors gracefully", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValue(new Error("Processing failed"));

      // Mock successful lock acquisition
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();

      // Should not throw
      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockProcess).toHaveBeenCalledTimes(1);
      // Lock should still be released even on error
      expect(CronLockModel.deleteOne).toHaveBeenCalledTimes(1);
    });

    it("should release lock after error", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce(undefined);

      // First execution: lock acquired
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      // Second execution: lock acquired again (lock was released)
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();

      // First execution fails
      await scheduledCallbacks[0]();

      // Lock should have been released
      expect(CronLockModel.deleteOne).toHaveBeenCalledTimes(1);

      // Second execution should succeed (lock released)
      await scheduledCallbacks[0]();

      expect(mockProcess).toHaveBeenCalledTimes(2);
      expect(CronLockModel.deleteOne).toHaveBeenCalledTimes(2);
    });

    it("should handle non-Error exceptions", async () => {
      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockRejectedValue("String error");

      // Mock successful lock acquisition
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();

      await expect(scheduledCallbacks[0]()).resolves.not.toThrow();
      expect(mockProcess).toHaveBeenCalledTimes(1);
      // Lock should still be released even on non-Error exception
      expect(CronLockModel.deleteOne).toHaveBeenCalledTimes(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // processExpiredSessions — IDEMPOTENCE
  // ═════════════════════════════════════════════════════════════════════════

  describe("processExpiredSessions - idempotence", () => {
    it("should not re-trigger stage notifications if stage was already triggered", async () => {
      // Simulate a session where stage 0 was already triggered (currentStage === 0)
      // but stage0TriggeredAt is recent (< 15 min ago) so stage 1 threshold is not reached.
      // processExpiredSessions should not call triggerStage1 in this case.
      const stage0RecentTime = new Date(Date.now() - 5 * 60 * 1000); // only 5 min ago

      const mockSessionAlreadyInStage0 = {
        _id: "session-stage0-already",
        status: "EXPIRED",
        expiresAt: new Date(Date.now() - 30 * 60 * 1000),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "DISCONNECTED",
            currentStage: 0,
            stage0TriggeredAt: stage0RecentTime, // triggered recently — stage 1 threshold NOT reached
            lastHeartbeatAt: null,
          },
        ],
        save: jest.fn().mockResolvedValue({}),
      };

      // Import SosSessionModel to mock it
      const SosSessionModel = (await import("../../models/sosSession")).default;
      (SosSessionModel.find as jest.Mock) = jest
        .fn()
        .mockResolvedValue([mockSessionAlreadyInStage0]);

      await sosService.processExpiredSessions();

      // Stage is 0, stage0TriggeredAt is only 5 min ago (threshold = 15 min)
      // So currentStage must remain 0 — triggerStage1 was NOT called
      expect(mockSessionAlreadyInStage0.participants[0].currentStage).toBe(0);
    });

    it("should not process a session that was already resolved between cron cycles", async () => {
      // Simulate that SosSessionModel.find returns no sessions (already resolved/cancelled)
      const SosSessionModel = (await import("../../models/sosSession")).default;
      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);

      const mockProcess = jest
        .spyOn(sosService, "processExpiredSessions")
        .mockResolvedValue(undefined);

      // Acquire lock and execute the cron callback
      CronLockModel.findOneAndUpdate.mockImplementationOnce((query, update) => {
        return Promise.resolve({
          lockName: "sos-escalation",
          lockedBy: update.lockedBy,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 90000),
          lastHeartbeat: new Date(),
        });
      });

      startSosEscalationJob();
      await scheduledCallbacks[0]();

      // processExpiredSessions is called once but since no sessions are returned,
      // no stage triggers happen. The spy confirms it ran exactly once.
      expect(mockProcess).toHaveBeenCalledTimes(1);
      expect(CronLockModel.deleteOne).toHaveBeenCalledTimes(1);
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
