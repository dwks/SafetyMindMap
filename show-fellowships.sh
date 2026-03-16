#!/bin/sh
jq '[.records[] | select(.Type | contains(["Fellowship"])) | {name: .Name, start: ."Start date", end: ."End date", link: ."Link".url}]' aisafety_events.json
