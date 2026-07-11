export class AttestorError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = false) {
    super(message);
    this.name = "AttestorError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function attestorError(error: unknown): AttestorError {
  if (error instanceof AttestorError) return error;
  if (error instanceof Error) return new AttestorError("ATTESTATION_FAILED", error.message);
  return new AttestorError("ATTESTATION_FAILED", "Answer attestation failed");
}
