ALTER TABLE "students" DROP CONSTRAINT "students_student_no_not_blank";--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "student_no" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_student_no_not_blank" CHECK ("students"."student_no" is null or length(trim("students"."student_no")) > 0);