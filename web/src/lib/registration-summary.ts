export type RegistrationStatus = "registered" | "pending" | "missing_student_no";

export type RegistrationMember = {
  id: number;
  name: string;
  studentNo: string | null;
  status: RegistrationStatus;
  registered: boolean;
};

export type RegistrationOverview = {
  members: RegistrationMember[];
  total: number;
  registered: number;
  pending: number;
  missingStudentNo: number;
  rate: number;
};

export function summarizeRegistration(
  rows: Array<{ id: number; name: string; studentNo: string | null; userId: string | null }>,
): RegistrationOverview {
  const members = rows.map((row) => {
    const registered = row.userId !== null;
    const status: RegistrationStatus = registered
      ? "registered"
      : row.studentNo
        ? "pending"
        : "missing_student_no";

    return { id: row.id, name: row.name, studentNo: row.studentNo, status, registered };
  });
  const registered = members.filter((member) => member.registered).length;
  const missingStudentNo = members.filter((member) => member.status === "missing_student_no").length;
  const total = members.length;

  return {
    members,
    total,
    registered,
    pending: total - registered,
    missingStudentNo,
    rate: total === 0 ? 0 : Math.round((registered / total) * 100),
  };
}
