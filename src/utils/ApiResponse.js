const HttpStatus = require('./httpStatus');

class ApiResponse {
    constructor(statusCode, message, data) {
        this.statusCode = statusCode;
        this.message = message;
        this.data = data;
        this.success = statusCode >= 200 && statusCode < 300;
        this.timestamp = new Date().toISOString();
    }
}

class SuccessResponse extends ApiResponse {
    constructor(data, message = 'Success') {
        super(HttpStatus.OK, message, data);
    }
}

class CreatedResponse extends ApiResponse {
    constructor(data, message = 'Created') {
        super(HttpStatus.CREATED, message, data);
    }
}

class ErrorResponse extends ApiResponse {
    constructor(statusCode, message, errors = null) {
        super(statusCode, message, null);
        this.errors = errors;
    }
}

class NotFoundError extends ErrorResponse {
    constructor(message = 'Not Found') {
        super(HttpStatus.NOT_FOUND, message);
    }
}

class BadRequestError extends ErrorResponse {
    constructor(message = 'Bad Request', errors) {
        super(HttpStatus.BAD_REQUEST, message, errors);
    }
}

class InternalError extends ErrorResponse {
    constructor(message = 'Internal Server Error') {
        super(HttpStatus.INTERNAL_SERVER_ERROR, message);
    }
}

class UnauthorizedError extends ErrorResponse {
    constructor(message = 'Unauthorized') {
        super(HttpStatus.UNAUTHORIZED, message);
    }
}

module.exports = {
    ApiResponse,
    SuccessResponse,
    CreatedResponse,
    ErrorResponse,
    NotFoundError,
    BadRequestError,
    InternalError,
    UnauthorizedError
};
