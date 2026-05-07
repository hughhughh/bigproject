import type { ObjectId } from "mongodb";

export type CalendarItemType = "task" | "activity";

export type TimeSegment = {
  startAt: Date;
  endAt: Date;
};

export type CalendarSeriesDoc = {
  _id: ObjectId;
  userId: ObjectId;
  type: CalendarItemType;
  title: string;
  description?: string;
  movable: boolean;
  colorHex?: string;
  durationMinutes: number;
  recurrence?: {
    rrule?: string;
    exDates?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
};

export type CalendarOccurrenceDoc = {
  _id: ObjectId;
  userId: ObjectId;
  seriesId: ObjectId;
  segments: TimeSegment[];
  completedAt?: Date | null;
  isException?: boolean;
  source?: "user" | "ai";
  createdAt: Date;
  updatedAt: Date;
};

/** Structured calendar change produced by the LLM or tests. */
export type CalendarOp =
  | {
      op: "createSeriesAndOccurrence";
      type: CalendarItemType;
      title: string;
      movable?: boolean;
      colorHex?: string;
      durationMinutes: number;
      segments: { startAt: string; endAt: string }[];
    }
  | {
      op: "deleteOccurrence";
      occurrenceId: string;
    }
  | {
      op: "moveOccurrence";
      occurrenceId: string;
      segments: { startAt: string; endAt: string }[];
    }
  | {
      op: "setOccurrenceComplete";
      occurrenceId: string;
      completed: boolean;
    };
