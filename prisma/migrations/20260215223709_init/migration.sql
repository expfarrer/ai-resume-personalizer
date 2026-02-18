-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobDesc" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL
);
