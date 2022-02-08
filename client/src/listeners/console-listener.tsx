import { ConsoleMessage } from '../../../frontend/src/util/shared-types';
import { patch, stringify } from '../utils/utils';
import ErrorStackParser from 'error-stack-parser';

export type StringifyOptions = {
    // limit of string length
    stringLengthLimit?: number;
    /**
     * limit of number of keys in an object
     * if an object contains more keys than this limit, we would call its toString function directly
     */
    numOfKeysLimit: number;
    /**
     * limit number of depth in an object
     * if an object is too deep, toString process may cause browser OOM
     */
    depthOfLimit: number;
};

type LogRecordOptions = {
    level: ConsoleMethods[];
    lengthThreshold: number;
    stringifyOptions: StringifyOptions;
    logger: Logger | 'console';
};

type Logger = {
    assert?: typeof console.assert;
    clear?: typeof console.clear;
    count?: typeof console.count;
    countReset?: typeof console.countReset;
    debug?: typeof console.debug;
    dir?: typeof console.dir;
    dirxml?: typeof console.dirxml;
    error?: typeof console.error;
    group?: typeof console.group;
    groupCollapsed?: typeof console.groupCollapsed;
    groupEnd?: () => void;
    info?: typeof console.info;
    log?: typeof console.log;
    table?: typeof console.table;
    time?: typeof console.time;
    timeEnd?: typeof console.timeEnd;
    timeLog?: typeof console.timeLog;
    trace?: typeof console.trace;
    warn?: typeof console.warn;
};

export const ALL_CONSOLE_METHODS = [
    'assert',
    'count',
    'countReset',
    'debug',
    'dir',
    'dirxml',
    'error',
    'group',
    'groupCollapsed',
    'groupEnd',
    'info',
    'log',
    'table',
    'time',
    'timeEnd',
    'timeLog',
    'trace',
    'warn',
] as const;
type ConsoleMethodsTuple = typeof ALL_CONSOLE_METHODS;
export type ConsoleMethods = ConsoleMethodsTuple[number];

export function ConsoleListener(
    callback: (c: ConsoleMessage) => void,
    logOptions: LogRecordOptions
) {
    const loggerType = logOptions.logger;
    if (!loggerType) {
        return () => {};
    }
    let logger: Logger;
    if (typeof loggerType === 'string') {
        logger = window[loggerType];
    } else {
        logger = loggerType;
    }
    let logCount = 0;
    const cancelHandlers: (() => void)[] = [];

    // add listener to thrown errors
    if (logOptions.level.includes('error')) {
        if (window) {
            const errorHandler = (event: ErrorEvent) => {
                const { message, error } = event;
                let trace: any[] = [];
                if (error) {
                    trace = ErrorStackParser.parse(error);
                }
                const payload = [
                    stringify(message, logOptions.stringifyOptions),
                ];
                callback({
                    type: 'Error',
                    trace: trace.slice(1),
                    time: Date.now(),
                    value: payload,
                });
            };
            window.addEventListener('error', errorHandler);
            cancelHandlers.push(() => {
                if (window) window.removeEventListener('error', errorHandler);
            });
        }
    }

    for (const levelType of logOptions.level) {
        cancelHandlers.push(replace(logger, levelType));
    }
    return () => {
        cancelHandlers.forEach((h) => h());
    };

    /**
     * replace the original console function and record logs
     * @param logger the logger object such as Console
     * @param level the name of log function to be replaced
     */
    function replace(_logger: Logger, level: ConsoleMethods) {
        if (!_logger[level]) {
            return () => {};
        }
        // replace the logger.{level}. return a restore function
        return patch(_logger, level, (original) => {
            return (...args: Array<any>) => {
                // @ts-expect-error
                original.apply(this, args);
                try {
                    const trace = ErrorStackParser.parse(new Error());
                    const payload = args.map((s) =>
                        stringify(s, logOptions.stringifyOptions)
                    );
                    logCount++;
                    if (logCount < logOptions.lengthThreshold) {
                        callback({
                            type: level,
                            trace: trace.slice(1),
                            value: payload,
                            time: Date.now(),
                        });
                    } else if (logCount === logOptions.lengthThreshold) {
                        // notify the user
                        callback({
                            type: 'Warn',
                            time: Date.now(),
                            value: [
                                stringify(
                                    'The number of log records reached the threshold.'
                                ),
                            ],
                        });
                    }
                } catch (error) {
                    original('highlight logger error:', error, ...args);
                }
            };
        });
    }
}
