<?php
declare(strict_types=1);

namespace Knit;

/** Thrown anywhere in the API; the front controller turns it into JSON. */
final class ApiError extends \RuntimeException
{
    public function __construct(string $message, private int $status = 400)
    {
        parent::__construct($message);
    }

    public function status(): int
    {
        return $this->status;
    }
}
