import hashlib
import os
import sys

def verify_pmf_alignment(file_path: str, expected_hash: str) -> bool:
    """
    Prevents 'Inside-Out' development by ensuring the execution 
    has not drifted from the original Problem Space definition.
    [Olsen, Ch. 2 & Fig 1.1]
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Problem space specification file not found: {file_path}")

    with open(file_path, "rb") as f:
        actual_hash = hashlib.sha256(f.read()).hexdigest()
    
    if actual_hash != expected_hash:
        # Triggering the Circuit Breaker to prevent Rework [Olsen, Ch. 1]
        raise PermissionError("Architectural Drift Detected: Plan integrity compromised.")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python pmf_attestation.py <file_path> <expected_hash>", file=sys.stderr)
        sys.exit(1)
    
    file_arg = sys.argv[1]
    hash_arg = sys.argv[2]
    try:
        verify_pmf_alignment(file_arg, hash_arg)
        print(f"[AEOS PMF VERIFIED] Plan {file_arg} aligns with verified Problem Space ({hash_arg[:16]}...)")
        sys.exit(0)
    except Exception as e:
        print(f"[CIRCUIT BREAKER TRIGGERED] {e}", file=sys.stderr)
        sys.exit(1)
