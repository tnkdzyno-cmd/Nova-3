import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { writeAudit } from "../middleware/audit.js";
import { badRequest, newId, paginate, matchesSearch } from "../util.js";
import type { Student, StudentStatus } from "../types.js";

export const studentsRouter = Router();
studentsRouter.use(authenticate);

const VALID_STATUSES: StudentStatus[] = ["active", "deferred", "suspended", "graduated"];

/** Paid / partial / unpaid, derived from a student's AR invoices — not stored, always computed fresh. */
export function billingStatusFor(studentId: string): "paid" | "partial" | "unpaid" {
  const invoices = store.data.invoices.filter((i) => i.studentId === studentId && i.kind === "AR" && i.status !== "void");
  const totalBilled = invoices.reduce((s, i) => s + i.totalAmount, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.amountPaid, 0);
  if (totalBilled === 0) return "unpaid"; // nothing billed yet
  if (totalPaid >= totalBilled) return "paid";
  if (totalPaid > 0) return "partial";
  return "unpaid";
}

// Advanced filtering for bulk billing and the student roster: campus,
// status, intake, academic year, billing status, plus free-text search
// across student number / name / program.
studentsRouter.get("/", require("student:read"), (req, res) => {
  const { search, campus, status, intake, academicYear, billingStatus } = req.query;
  let students = store.data.students;
  if (search) students = students.filter((s) => matchesSearch(search, s.studentNumber, s.name, s.program));
  if (campus) students = students.filter((s) => s.campus === campus);
  if (status) students = students.filter((s) => s.status === status);
  if (intake) students = students.filter((s) => s.intake === intake);
  if (academicYear) students = students.filter((s) => s.academicYear === academicYear);
  if (billingStatus) students = students.filter((s) => billingStatusFor(s.id) === billingStatus);

  const { data, total, page, pageSize, totalPages } = paginate(students, req.query);
  res.json({ students: data.map((s) => ({ ...s, billingStatus: billingStatusFor(s.id) })), total, page, pageSize, totalPages });
});

// Distinct values for each filter's dropdown — cheaper than the frontend
// guessing, and stays correct as students with new campuses/intakes are added.
studentsRouter.get("/filter-options", require("student:read"), (_req, res) => {
  const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].sort();
  res.json({
    campuses: distinct(store.data.students.map((s) => s.campus)),
    intakes: distinct(store.data.students.map((s) => s.intake)),
    academicYears: distinct(store.data.students.map((s) => s.academicYear)),
    statuses: VALID_STATUSES,
  });
});

studentsRouter.post("/", require("student:write"), (req, res, next) => {
  try {
    const { studentNumber, name, program, guardianContact, guardianEmail, campus, intake, academicYear, status } = req.body ?? {};
    if (!studentNumber || !name) throw badRequest("MISSING_FIELDS", "studentNumber and name are required.");
    if (store.data.students.some((s) => s.studentNumber === studentNumber)) {
      throw badRequest("DUPLICATE_STUDENT_NUMBER", `Student number ${studentNumber} already exists.`);
    }
    if (status && !VALID_STATUSES.includes(status)) {
      throw badRequest("INVALID_STATUS", `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    const student: Student = {
      id: newId(),
      studentNumber,
      name,
      program: program ?? "",
      guardianContact: guardianContact ?? "",
      guardianEmail: guardianEmail || null,
      campus: campus || undefined,
      intake: intake || undefined,
      academicYear: academicYear || undefined,
      status: status || "active",
    };
    store.data.students.push(student);
    writeAudit(store.data, { entityType: "Student", entityId: student.id, action: "CREATE", before: null, after: student, user: req.user! });
    store.save();
    res.status(201).json({ student });
  } catch (e) {
    next(e);
  }
});

// Status changes (e.g. active -> deferred/suspended/graduated) are common
// enough over a student's lifecycle to warrant their own audited update path
// rather than folding into a generic PATCH-everything route.
studentsRouter.patch("/:id", require("student:write"), (req, res, next) => {
  try {
    const student = store.data.students.find((s) => s.id === req.params.id);
    if (!student) throw badRequest("NOT_FOUND", "Student not found.");
    const { status, campus, intake, academicYear } = req.body ?? {};
    if (status && !VALID_STATUSES.includes(status)) {
      throw badRequest("INVALID_STATUS", `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    const before = { ...student };
    if (status !== undefined) student.status = status;
    if (campus !== undefined) student.campus = campus;
    if (intake !== undefined) student.intake = intake;
    if (academicYear !== undefined) student.academicYear = academicYear;
    writeAudit(store.data, { entityType: "Student", entityId: student.id, action: "UPDATE", before, after: student, user: req.user! });
    store.save();
    res.json({ student });
  } catch (e) {
    next(e);
  }
});

studentsRouter.get("/:id", require("student:read"), (req, res) => {
  const student = store.data.students.find((s) => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Student not found." } });
  const invoices = store.data.invoices.filter((i) => i.studentId === student.id);
  const balance = invoices.reduce((sum, i) => sum + (i.totalAmount - i.amountPaid), 0);
  res.json({ student: { ...student, billingStatus: billingStatusFor(student.id) }, invoices, balance });
});
