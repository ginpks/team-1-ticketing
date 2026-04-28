#!/bin/bash

# use this to seed the DLQ with bad requests
redis-cli -h redis LPUSH ticket-purchase-queue \
    'not-valid-json' \
    '{"event":"Ghost Concert","seat":"B12"}' \
    '{"purchaseId":null,"amount":null,"event":null,"seat":null,"idempotency_key":null}' \
    '{"purchaseId":999999999,"amount":"99.99","event":"Phantom Event","seat":"Z99","idempotency_key":"poison-db-miss-1"}' \
    '{"purchaseId":888888888,"amount":"-1","event":"Bad Amount Show","seat":"A1","idempotency_key":"poison-neg-1"}'

