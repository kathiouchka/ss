package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

const (
	solanaAPI      = "https://api.mainnet-beta.solana.com"
	maxRetries     = 5
	retryDelayBase = 2 * time.Second
	maxConcurrency = 1
)

type RpcRequest struct {
	Jsonrpc string      `json:"jsonrpc"`
	ID      int         `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
}

type RpcResponse struct {
	Jsonrpc string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result"`
	Error   *RpcError       `json:"error,omitempty"`
}

type RpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Signature struct {
	Signature string `json:"signature"`
}

type Transaction struct {
	Slot        int64       `json:"slot"`
	Transaction interface{} `json:"transaction"`
	Meta        Meta        `json:"meta"`
}

type Meta struct {
	Err               interface{}    `json:"err"`
	Fee               uint64         `json:"fee"`
	PreBalances       []uint64       `json:"preBalances"`
	PostBalances      []uint64       `json:"postBalances"`
	PreTokenBalances  []TokenBalance `json:"preTokenBalances"`
	PostTokenBalances []TokenBalance `json:"postTokenBalances"`
}

type TokenBalance struct {
	AccountIndex  uint8         `json:"accountIndex"`
	Mint          string        `json:"mint"`
	Owner         string        `json:"owner"`
	UiTokenAmount UiTokenAmount `json:"uiTokenAmount"`
}

type UiTokenAmount struct {
	Amount         string  `json:"amount"`
	Decimals       uint8   `json:"decimals"`
	UiAmount       float64 `json:"uiAmount"`
	UiAmountString string  `json:"uiAmountString"`
}

func fetchSignatures(address string) ([]string, error) {
	params := []interface{}{address, map[string]interface{}{
		"limit": 10,
	}}

	reqBody := RpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getSignaturesForAddress",
		Params:  params,
	}

	var signatures []string
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	resp, err := http.Post(solanaAPI, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var rpcResp RpcResponse
	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, err
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("RPC error: %s", rpcResp.Error.Message)
	}

	var sigs []Signature
	if err := json.Unmarshal(rpcResp.Result, &sigs); err != nil {
		return nil, err
	}

	for _, sig := range sigs {
		signatures = append(signatures, sig.Signature)
	}

	return signatures, nil
}

func fetchTransaction(signature string) (*Transaction, error) {
	params := []interface{}{signature, map[string]interface{}{
		"encoding":                       "json",
		"maxSupportedTransactionVersion": 0,
	}}

	reqBody := RpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params:  params,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	var tx Transaction
	for retries := 0; retries < maxRetries; retries++ {
		resp, err := http.Post(solanaAPI, "application/json", bytes.NewBuffer(body))
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		var rpcResp RpcResponse
		respBody, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}

		if err := json.Unmarshal(respBody, &rpcResp); err != nil {
			return nil, err
		}

		if rpcResp.Error != nil {
			if rpcResp.Error.Code == -32005 { // Rate limit error code
				delay := time.Duration(math.Pow(2, float64(retries)))*retryDelayBase + time.Duration(rand.Intn(1000))*time.Millisecond
				log.Printf("Rate limited, retrying in %s...", delay)
				time.Sleep(delay)
				continue
			}
			return nil, fmt.Errorf("RPC error: %s", rpcResp.Error.Message)
		}

		if err := json.Unmarshal(rpcResp.Result, &tx); err != nil {
			return nil, err
		}

		return &tx, nil
	}

	return nil, fmt.Errorf("max retries reached for transaction %s", signature)
}

func formatTransaction(tx *Transaction, solPrice float64) string {
	// Determine if it's a buy or sell transaction
	status := "Sold"
	preAmount := tx.Meta.PreTokenBalances[0].UiTokenAmount.UiAmount
	postAmount := tx.Meta.PostTokenBalances[0].UiTokenAmount.UiAmount
	preSol := float64(tx.Meta.PreBalances[tx.Meta.PreTokenBalances[0].AccountIndex]) / 1e9    // Converting lamports to SOL
	postSol := float64(tx.Meta.PostBalances[tx.Meta.PostTokenBalances[0].AccountIndex]) / 1e9 // Converting lamports to SOL

	var price, amount float64
	var amountStr string
	tokenChange := postAmount - preAmount
	solChange := postSol - preSol

	if tokenChange != 0 {
		status = "Bought"
		amount = math.Abs(tokenChange)
		price = math.Abs(solChange / tokenChange) // Ensure no division by zero
		amountStr = fmt.Sprintf("%.4f SOL -> %.4f Token", solChange, tokenChange)
	} else {
		amount = math.Abs(solChange)
		if amount != 0 {
			price = solPrice // Price per SOL in USD
			amountStr = fmt.Sprintf("%.4f Token -> %.4f SOL", tokenChange, solChange)
		} else {
			price = 0
			amountStr = "No change"
		}
	}

	// Check for zero amounts which can lead to division by zero
	if tokenChange == 0 {
		price = 0
	}

	// Calculate the value in USD
	value := price * amount * solPrice

	// Get the wallet address of the transaction initiator
	walletAddress := tx.Meta.PreTokenBalances[0].Owner

	// Calculate the timestamp
	timestamp := time.Unix(int64(tx.Slot)/400, 0) // assuming ~400 slots per second
	timeAgo := time.Since(timestamp).Seconds()
	timeAgoStr := fmt.Sprintf("%.0fs ago", timeAgo)

	return fmt.Sprintf("%-8s | %-7s | $%-10.6f | $%-8.2f | %-25s | %s",
		timeAgoStr,
		status,
		price,
		value,
		amountStr,
		walletAddress)
}

func main() {

	address := ""
	solPrice := 150

	signatures, err := fetchSignatures(address)
	if err != nil {
		log.Fatalf("Error fetching signatures: %v", err)
	}

	semaphore := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	fmt.Println("Time     | Type   | Price       | Value   | Amount                  | By")
	fmt.Println("---------|--------|-------------|---------|-------------------------|----------------------")

	for _, sig := range signatures {
		semaphore <- struct{}{}
		wg.Add(1)

		go func(sig string) {
			defer func() {
				<-semaphore
				wg.Done()
			}()

			tx, err := fetchTransaction(sig)
			if err != nil {
				log.Printf("Error fetching transaction %s: %v", sig, err)
				return
			}
			fmt.Println(formatTransaction(tx, solPrice))
		}(sig)

		time.Sleep(5 * time.Second) // Add delay between each request
	}

	wg.Wait()
}
