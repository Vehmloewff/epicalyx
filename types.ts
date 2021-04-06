import { InnerJson } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

export interface ResError {
	code: 'INTERNAL_ERROR' | 'FORBIDDEN' | 'USER_FAULT' | string
	message: string
}

export interface MethodReq {
	epicalyx: '1.0'
	type: 'method-req'
	id: string
	method: string
	params: InnerJson
}

export interface MethodRes {
	epicalyx: '1.0'
	type: 'method-res'
	id: string
	result: InnerJson
	error: ResError | null
}

export interface ListenReq {
	epicalyx: '1.0'
	type: 'listen-req'
	id: string
	scope: string
	params: InnerJson
}

export interface ListenRes {
	epicalyx: '1.0'
	type: 'listen-res'
	id: string
	error: ResError | null
}

export interface ListenBeam {
	epicalyx: '1.0'
	type: 'listen-beam'
	id: string
	data: InnerJson
}

export interface TransmissionReq {
	epicalyx: '1.0'
	type: 'transmission-req'
	id: string
	resource: string
	stashedChangesOverview: { [timestamp: string]: number }
}

export type TransmissionRes = TransmissionResError | TransmissionResOk

interface TransmissionResError {
	epicalyx: '1.0'
	type: 'transmission-res'
	id: string
	error: ResError
	catchUpData: null
}

interface TransmissionResOk {
	epicalyx: '1.0'
	type: 'transmission-res'
	id: string
	error: null
	catchUpData: TransmissionResCatchUpDataReplace | TransmissionResCatchUpDataFill
}

export interface TransmissionDataUpdate {
	indexes: [number, number]
	data: string
}

export interface TransmissionResCatchUpDataReplace {
	strategy: 'replace'
	data: string
	last30Updates: {
		[timestamp: string]: TransmissionDataUpdate[]
	}
}

export interface TransmissionResCatchUpDataFill {
	strategy: 'fill'
	changes: { [timestamp: string]: TransmissionDataUpdate[] }
}

export interface TransmissionUpdate {
	epicalyx: '1.0'
	type: 'transmission-update'
	id: string
	timestamp: string
	changes: TransmissionDataUpdate[]
}

export interface TransmissionUpdateRecall {
	epicalyx: '1.0'
	type: 'transmission-update-recall'
	id: string
	timestamp: string
	index: 0
}

export interface ConnectionClosing {
	epicalyx: '1.0'
	type: 'connection-closing'
	code: 'BAD_MESSAGES' | string
	reason: string
}

export type EpicalyxMessageDown =
	| ConnectionClosing
	| TransmissionUpdateRecall
	| TransmissionUpdate
	| TransmissionRes
	| ListenBeam
	| ListenRes
	| MethodRes

export type EpicalyxMessageUp = TransmissionUpdate | TransmissionReq | ListenReq | MethodReq
