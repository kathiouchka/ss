package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const (
	WebSocketScheme = "wss"
	WebSocketHost   = "mainnet.helius-rpc.com"
	APIKeyEnvVar    = "API_KEY"
)

func extractTokenTransfers(logs []interface{}) []string {
	var transfers []string
	for i, log := range logs {
		logStr, ok := log.(string)
		if !ok {
			continue
		}
		if logStr == "Program  invoke [3]" {
			if i+1 < len(logs) {
				nextLog, ok := logs[i+1].(string)
				if ok && nextLog == "Program log: Instruction: Transfer" {
					transfers = append(transfers, "Token Transfer")
				}
			}
		}
	}
	return transfers
}

func connectAndSubscribe(mentions []string) (*websocket.Conn, error) {
	apiKey := os.Getenv(APIKeyEnvVar)
	if apiKey == "" {
		return nil, fmt.Errorf("API key not provided")
	}

	u := url.URL{Scheme: WebSocketScheme, Host: WebSocketHost, RawQuery: "api-key=" + apiKey}
	log.Printf("connecting to %s", u.String())

	dialer := websocket.Dialer{
		HandshakeTimeout: 45 * time.Second,
		ReadBufferSize:   1024,
		WriteBufferSize:  1024,
	}

	c, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("dial error: %v", err)
	}

	subscribe := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "logsSubscribe",
		"params": []interface{}{
			map[string]interface{}{
				"mentions": mentions,
			},
			map[string]string{
				"commitment": "finalized",
			},
		},
	}

	message, err := json.Marshal(subscribe)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("JSON marshal error: %v", err)
	}

	err = c.WriteMessage(websocket.TextMessage, message)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("write error: %v", err)
	}

	return c, nil
}

func main() {
	walletPubKey := ""
	pingInterval := 25 * time.Second

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	for {
		c, err := connectAndSubscribe([]string{walletPubKey})
		if err != nil {
			log.Println("Failed to connect:", err)
			time.Sleep(3 * time.Second)
			continue
		}

		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := c.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
						log.Println("ping:", err)
						c.Close()
						return
					}
				case <-done:
					return
				}
			}
		}()

		go func() {
			for {
				_, message, err := c.ReadMessage()
				if err != nil {
					log.Println("read:", err)
					c.Close()
					close(done)
					break
				}

				var messageData map[string]interface{}
				if err := json.Unmarshal(message, &messageData); err != nil {
					log.Printf("Failed to unmarshal message: %v", err)
					continue
				}

				params, ok := messageData["params"].(map[string]interface{})
				if !ok {
					continue
				}

				result, ok := params["result"].(map[string]interface{})
				if !ok {
					continue
				}

				value, ok := result["value"].(map[string]interface{})
				if !ok {
					continue
				}

				signature, ok := value["signature"].(string)
				if !ok {
					continue
				}

				logs, ok := value["logs"].([]interface{})
				if !ok {
					continue
				}

				transfers := extractTokenTransfers(logs)

				if len(transfers) > 0 {
					fmt.Printf("Transaction Signature: %s\n", signature)
					fmt.Println("Token Transfers:")
					for _, transfer := range transfers {
						fmt.Printf("- %s\n", transfer)
					}
					fmt.Println("------------------------")
				}
			}
		}()

		select {
		case <-interrupt:
			log.Println("Interrupt received, shutting down...")
			c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			time.Sleep(1 * time.Second)
			return
		case <-done:
			log.Println("Connection closed, reconnecting...")
		}

		time.Sleep(3 * time.Second)
	}
}
