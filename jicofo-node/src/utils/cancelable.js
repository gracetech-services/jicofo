/**
 * Interface for objects that can be cancelled.
 * This is a simple interface that defines a cancel method.
 */
class Cancelable {
    /**
     * Cancel the operation or task.
     * This method should be implemented by subclasses.
     */
    cancel() {
        throw new Error('cancel() method must be implemented by subclass');
    }
}

/**
 * A simple implementation of Cancelable that can be used as a base class
 * or for testing purposes.
 */
class SimpleCancelable extends Cancelable {
    constructor(cancelCallback = null) {
        super();
        this.cancelCallback = cancelCallback;
        this.isCancelled = false;
    }

    cancel() {
        if (!this.isCancelled) {
            this.isCancelled = true;
            if (this.cancelCallback) {
                this.cancelCallback();
            }
        }
    }

    isCancelled() {
        return this.isCancelled;
    }
}

/**
 * A cancelable that wraps a timeout or interval.
 */
class TimeoutCancelable extends Cancelable {
    constructor(timeoutId) {
        super();
        this.timeoutId = timeoutId;
        this.isCancelled = false;
    }

    cancel() {
        if (!this.isCancelled && this.timeoutId) {
            this.isCancelled = true;
            clearTimeout(this.timeoutId);
            clearInterval(this.timeoutId);
            this.timeoutId = null;
        }
    }
}

/**
 * A cancelable that can cancel multiple other cancelables.
 */
class CompositeCancelable extends Cancelable {
    constructor() {
        super();
        this.cancelables = [];
    }

    add(cancelable) {
        if (cancelable && typeof cancelable.cancel === 'function') {
            this.cancelables.push(cancelable);
        }
    }

    cancel() {
        this.cancelables.forEach(cancelable => {
            try {
                cancelable.cancel();
            } catch (error) {
                // Log error but continue cancelling other items
                console.error('Error cancelling item:', error);
            }
        });
        this.cancelables = [];
    }
}

module.exports = {
    Cancelable,
    SimpleCancelable,
    TimeoutCancelable,
    CompositeCancelable
}; 